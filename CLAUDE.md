# POS Papelerías — Ravyn Studio

## Qué es

POS local para papelerías en México. Un servicio Node (Fastify + SQLite) corre como servicio
de Windows en la PC del mostrador y sirve la interfaz (Vite + React) por localhost; el usuario la abre en su navegador predeterminado.
Funciona 100% sin internet. Primer cliente: Papelería Las Fuentes.
Usuarios poco técnicos: velocidad y claridad > estética.

Plan completo (fuente de verdad): página de Notion "POS Papelerías — Plan de implementación (Piloto Las Fuentes)".

## Comandos

- pnpm dev # server + pos
- pnpm test # vitest
- pnpm e2e # playwright
- pnpm db:migrate # migraciones
- pnpm db:seed # datos de prueba de papelería
- pnpm lint && pnpm typecheck

(Algunos comandos aún no existen; se agregan conforme avanzan las tareas del plan.)

## Reglas no negociables

1. Dinero SIEMPRE en centavos enteros. Usa packages/core/money. Nunca float.
2. sales, payments, inventory_movements, print_jobs (tras resolverse) y audit_log son inmutables:
   corregir = registro nuevo.
3. El stock es la suma de inventory_movements. Nunca una columna editable.
4. Toda operación que toque dinero o inventario va en UNA transacción.
5. Cancelaciones, descuentos sobre umbral, ajustes, conteos, cambios de precio
   e impresiones ignoradas escriben audit_log.
6. Nada en el camino de venta/cobro depende de internet.
7. IDs UUIDv7 locales. Folios solo los asigna el servidor.
8. Todas las tablas llevan tenant_id y store_id.
9. La impresora térmica y el cajón son opcionales: todo flujo debe funcionar sin ellos.
10. Nunca guardar secretos (CSD, tokens) en el repo ni en logs.
11. Todo lo que dependa del sistema operativo o del hardware (detección de impresiones,
    impresora térmica, cajón, servicio de Windows) va detrás de una interfaz en
    apps/server/src/adapters con implementación real y simulada. El código de negocio
    nunca llama a PowerShell, USB ni APIs de Windows directamente.
12. El desarrollo es en macOS; el destino es Windows 11 x64. Usa path.join, nunca rutas
    escritas a mano, y no asumas mayúsculas/minúsculas en nombres de archivo.

## Convenciones

- Lógica de negocio pura en packages/core; los módulos del server orquestan.
- Validación Zod en cada endpoint.
- Código en inglés; textos de interfaz y errores en español de México.
- Todo operable por teclado; botones grandes.
- Commits pequeños: tipo(módulo): descripción.

## Cómo trabajar una tarea

1. Lee la tarea y sus criterios de aceptación en el plan.
2. Escribe primero las pruebas de los criterios.
3. Implementa lo mínimo para pasarlas. Sin features extra.
4. Corre lint, typecheck y test antes de dar la tarea por hecha.
5. Si cambia una decisión de arquitectura, anótala en docs/decisiones.md.
