import { describe, expect, it } from 'vitest';
import { accessFor, PERMISSIONS, type Permission } from './permissions.js';

// Matriz 3.1 del plan.
const EMPLOYEE_ALLOWED: Permission[] = [
  'sales.create',
  'shift.manage',
  'prints.ignore',
  'barcodes.print',
];
const EMPLOYEE_NEEDS_ADMIN_PIN: Permission[] = ['sales.cancel', 'discount.overThreshold'];
const EMPLOYEE_DENIED: Permission[] = [
  'catalog.manage',
  'inventory.adjust',
  'users.manage',
  'settings.manage',
  'reports.view',
  'audit.view',
];

describe('matriz de permisos', () => {
  it('admin puede todo', () => {
    for (const p of PERMISSIONS) expect(accessFor('admin', p)).toBe('allow');
  });
  it.each(EMPLOYEE_ALLOWED)('empleado puede %s', (p) => {
    expect(accessFor('employee', p)).toBe('allow');
  });
  it.each(EMPLOYEE_NEEDS_ADMIN_PIN)('empleado necesita PIN de admin para %s', (p) => {
    expect(accessFor('employee', p)).toBe('admin_pin');
  });
  it.each(EMPLOYEE_DENIED)('empleado no puede %s', (p) => {
    expect(accessFor('employee', p)).toBe('deny');
  });
  it('la matriz cubre todos los permisos', () => {
    const covered = [...EMPLOYEE_ALLOWED, ...EMPLOYEE_NEEDS_ADMIN_PIN, ...EMPLOYEE_DENIED];
    expect([...covered].sort()).toEqual([...PERMISSIONS].sort());
  });
});
