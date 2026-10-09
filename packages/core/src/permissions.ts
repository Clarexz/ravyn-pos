export const ROLES = ['admin', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'sales.create', // vender, cobrar, tickets en espera, órdenes, agregar impresiones
  'shift.manage', // abrir/cerrar su turno y corte
  'prints.ignore', // ignorar impresión (con motivo; queda en bitácora)
  'barcodes.print', // imprimir hoja de códigos
  'sales.cancel',
  'discount.overThreshold',
  'catalog.manage', // catálogo, precios, códigos
  'inventory.adjust', // ajustes y conteos
  'users.manage',
  'settings.manage',
  'reports.view',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** allow: permitido · admin_pin: el empleado necesita aprobación con PIN de admin · deny: no. */
export type Access = 'allow' | 'admin_pin' | 'deny';

const EMPLOYEE_ACCESS: Record<Permission, Access> = {
  'sales.create': 'allow',
  'shift.manage': 'allow',
  'prints.ignore': 'allow',
  'barcodes.print': 'allow',
  'sales.cancel': 'admin_pin',
  'discount.overThreshold': 'admin_pin',
  'catalog.manage': 'deny',
  'inventory.adjust': 'deny',
  'users.manage': 'deny',
  'settings.manage': 'deny',
  'reports.view': 'deny',
  'audit.view': 'deny',
};

export function accessFor(role: Role, permission: Permission): Access {
  return role === 'admin' ? 'allow' : EMPLOYEE_ACCESS[permission];
}
