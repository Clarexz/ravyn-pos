# Decisiones acordadas

Piloto: Papelería Las Fuentes. Resumen de la sección 1 del plan.

| Tema                        | Decisión                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Equipo                      | Una sola PC nueva en el mostrador (Windows 11) con WhatsApp/correo del negocio y el POS. Equipos viejos no se usan.                                                      |
| Usuarios                    | Varios en la misma PC: cambio rápido por PIN y tickets en espera. 2 admins + empleados.                                                                                  |
| Arquitectura MVP            | Servicio local (fuente de verdad) + interfaz en navegador por localhost. Internet no participa en vender.                                                                |
| Después del MVP             | Réplica de solo lectura en la nube (local → nube) + panel en celular + alertas WhatsApp a admins.                                                                        |
| Registro                    | Todo ingreso de dinero y todo movimiento de inventario, incluidas hojas consumidas por impresiones.                                                                      |
| Impresiones                 | Se detecta trabajo y páginas. Usuario elige ticket (nuevo, actual, en espera), B/N o color, y puede corregir páginas. Ignorar requiere motivo y también descuenta hojas. |
| Copias de la multifuncional | No pasan por la PC: se cobran con la hoja de códigos de barras.                                                                                                          |
| Órdenes con folio           | Envolturas, engargolado, forrado, etc. Precio fijo. Se abre al dejar, se cierra al cobrar y entregar. Teléfono obligatorio.                                              |
| Códigos                     | Código de barras 1D (Code 128, no QR). Lector 1D USB.                                                                                                                    |
| Productos                   | Con variantes. Reportes agrupados por producto con desglose por variante.                                                                                                |
| Precios                     | Un precio por variante en el MVP + descuento con autorización. Modelo preparado para precio por volumen.                                                                 |
| Corte de caja               | Por turnos + corte parcial sin cerrar. Corte ciego.                                                                                                                      |
| Tickets impresos            | Térmica opcional. Órdenes con folio: siempre comprobante (térmica, talón en impresora normal o folio en pantalla). Ventas normales: opcional.                            |
| Cajón de dinero             | Hoy manual. Apertura automática lista si después usan electrónico.                                                                                                       |
| CFDI 4.0                    | Contemplado en el modelo de datos; se activa después del MVP.                                                                                                            |

| Apertura de la interfaz | Se abre en el navegador predeterminado del usuario (no Edge `--app`). El acceso directo "Punto de Venta" abre `http://localhost:<puerto>` con el navegador por defecto. |

# Bitácora técnica

## T0.6 Prueba de detección de impresiones

Pendiente (requiere Windows real con las mismas impresoras). Resultados aquí; definen T6.1.

## T0.7 Adaptadores

Interfaces en `apps/server/src/adapters/types.ts`. Implementaciones simuladas completas; las de Windows lanzan "pendiente" hasta su tarea (`WindowsPrintWatcher` → T6.1, `WindowsReceiptPrinter`/`WindowsCashDrawer` → T2.7, `WindowsServiceHost` → T7.2).
Variables: `POS_ADAPTERS=simulated`, `POS_SIM_PRINT_INTERVAL_MS` (trabajos de impresión falsos cada N ms), `POS_DATA_DIR`.

## T0.8 CI e instalador

- Node 22 LTS en lugar de 20 (Node 20 ya salió de soporte). El mismo Node se empaqueta con el instalador, porque el binario nativo de `better-sqlite3` depende de su versión.
- `.github/workflows/ci.yml`: lint, typecheck, build y pruebas en macOS y Windows; job `package-windows` genera el `.exe` con Inno Setup (`installer/pos.iss`).
- El instalador por ahora solo copia archivos y crea el acceso directo; servicio, autoarranque y registro de impresión entran en T7.2.

## T1.1 Acceso y roles

- PIN de 4 a 6 dígitos con hash `scrypt` de `node:crypto` (sin argon2/bcrypt: evita otra dependencia nativa en el instalador de Windows). Un PIN corto es débil por naturaleza; la defensa real es el bloqueo: 5 intentos fallidos → 5 min.
- Inicio de sesión: se elige el usuario y se teclea el PIN (`POST /api/auth/login {userId, pin}`). Sesiones en memoria con token `Bearer` y vigencia deslizante de 12 h; varias conviven para el cambio rápido de usuario.
- Matriz de permisos en `packages/core/src/permissions.ts` (`allow` / `admin_pin` / `deny`). `requirePermission` responde 403 con `requiresAdminPin: true` cuando el empleado puede proceder con PIN de admin; el PIN se valida en `POST /api/auth/admin-approval` (con su propio bloqueo).
- `POST /api/setup` crea negocio, tienda y primer admin, solo si no existe ningún negocio.
- Pendiente: la bitácora de cancelaciones/descuentos aprobados con PIN se escribe en T2.6; cambiar/desactivar usuarios llega con la pantalla de administración.

## T1.2 Catálogo

- Tablas: `categories`, `products`, `product_variants`, `barcodes`. El precio base vive en el producto; la variante lo hereda salvo que defina el suyo (`priceCents` null = hereda; 0 es un precio válido).
- Un producto sin variantes crea una variante única sin nombre. "Controla inventario" es del producto (los servicios no controlan).
- Un código de barras es único por tienda, en cualquier variante. Los productos y variantes no se borran, se desactivan (`active`); los códigos sí se pueden quitar y reutilizar. (Cuando existan ventas, el historial guarda variante y nombre al momento, no el código.)
- Todo cambio de precio escribe `audit_log` (`price.change`, con `from`/`to`).
- Lectura del catálogo: cualquier usuario con sesión. Escritura: permiso `catalog.manage` (solo admin).
- Campos reservados sin pantalla: `volumePricing` y claves SAT en variantes.
- El código de barras de `quick_codes` (T3.1) deberá validar que no choque con `barcodes`.
