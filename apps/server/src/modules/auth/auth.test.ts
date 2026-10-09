import { createDb, runMigrations, type PosDb } from '@pos/db';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { hashPin, isValidPin, verifyPin } from './pin.js';
import { requirePermission } from './routes.js';
import {
  AuthError,
  AuthService,
  LOCK_MS,
  MAX_FAILED_ATTEMPTS,
  SESSION_IDLE_MS,
  type SessionUser,
} from './service.js';

function freshDb(): PosDb {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('pin', () => {
  it('valida 4 a 6 dígitos', () => {
    expect(['1234', '123456'].every(isValidPin)).toBe(true);
    expect(['123', '1234567', 'abcd', '12 34', ''].some(isValidPin)).toBe(false);
  });
  it('hashea y verifica', async () => {
    const hash = await hashPin('4821');
    expect(hash).not.toContain('4821');
    expect(await verifyPin('4821', hash)).toBe(true);
    expect(await verifyPin('4822', hash)).toBe(false);
  });
  it('dos hashes del mismo PIN son distintos (sal)', async () => {
    expect(await hashPin('1111')).not.toBe(await hashPin('1111'));
  });
});

describe('AuthService', () => {
  let clock: number;
  let auth: AuthService;
  let admin: SessionUser;
  let employee: SessionUser;

  beforeEach(async () => {
    clock = 1_000_000;
    auth = new AuthService(freshDb(), () => clock);
    admin = await auth.setup({ tenantName: 'T', storeName: 'S', adminName: 'Dueño', pin: '1234' });
    employee = await auth.createUser(admin, { name: 'Ana', role: 'employee', pin: '5678' });
  });

  it('setup solo funciona una vez', async () => {
    expect(auth.needsSetup()).toBe(false);
    await expect(
      auth.setup({ tenantName: 'x', storeName: 'x', adminName: 'x', pin: '1111' }),
    ).rejects.toMatchObject({ code: 'setup_done' });
  });

  it('login correcto da sesión con el usuario', async () => {
    const { token, user } = await auth.login(employee.id, '5678');
    expect(user).toMatchObject({ name: 'Ana', role: 'employee' });
    expect(auth.authenticate(token)?.id).toBe(employee.id);
  });

  it('PIN incorrecto o usuario inexistente dan el mismo error', async () => {
    const a = await auth.login(employee.id, '0000').catch((e: AuthError) => e);
    const b = await auth.login('no-existe', '5678').catch((e: AuthError) => e);
    expect(a).toMatchObject({ code: 'invalid_credentials' });
    expect((b as AuthError).message).toBe((a as AuthError).message);
  });

  it('bloquea tras 5 intentos fallidos y se libera con el tiempo', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await expect(auth.login(employee.id, '0000')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    }
    await expect(auth.login(employee.id, '0000')).rejects.toMatchObject({ code: 'locked' });
    // Aun con el PIN correcto sigue bloqueado.
    await expect(auth.login(employee.id, '5678')).rejects.toMatchObject({ code: 'locked' });
    clock += LOCK_MS + 1;
    await expect(auth.login(employee.id, '5678')).resolves.toBeTruthy();
  });

  it('un login correcto reinicia el contador de intentos', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++)
      await auth.login(employee.id, '0').catch(() => {});
    await auth.login(employee.id, '5678');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await expect(auth.login(employee.id, '0000')).rejects.toMatchObject({
        code: 'invalid_credentials',
      });
    }
  });

  it('la sesión expira por inactividad y logout la cierra', async () => {
    const { token } = await auth.login(employee.id, '5678');
    clock += SESSION_IDLE_MS - 1;
    expect(auth.authenticate(token)).toBeTruthy(); // renueva
    clock += SESSION_IDLE_MS - 1;
    expect(auth.authenticate(token)).toBeTruthy();
    auth.logout(token);
    expect(auth.authenticate(token)).toBeUndefined();
    const second = await auth.login(employee.id, '5678');
    clock += SESSION_IDLE_MS + 1;
    expect(auth.authenticate(second.token)).toBeUndefined();
  });

  it('varias sesiones conviven (cambio rápido de usuario)', async () => {
    const a = await auth.login(admin.id, '1234');
    const e = await auth.login(employee.id, '5678');
    expect(auth.authenticate(a.token)?.role).toBe('admin');
    expect(auth.authenticate(e.token)?.role).toBe('employee');
  });

  it('aprobación con PIN de admin: acepta el de un admin y rechaza otros', async () => {
    expect((await auth.approveWithAdminPin(employee, '1234'))?.id).toBe(admin.id);
    expect(await auth.approveWithAdminPin(employee, '5678')).toBeUndefined(); // PIN de empleado
  });

  it('la aprobación con PIN de admin se bloquea tras demasiados fallos', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await auth.approveWithAdminPin(employee, '0000');
    await expect(auth.approveWithAdminPin(employee, '1234')).rejects.toMatchObject({
      code: 'locked',
    });
  });
});

describe('rutas', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let employeeToken: string;

  beforeEach(async () => {
    app = await buildApp({ db: freshDb() });
    app.get(
      '/test/cancel',
      { preHandler: requirePermission(app.auth, 'sales.cancel') },
      async () => ({
        ok: true,
      }),
    );
    app.get(
      '/test/sell',
      { preHandler: requirePermission(app.auth, 'sales.create') },
      async () => ({
        ok: true,
      }),
    );

    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { tenantName: 'T', storeName: 'S', adminName: 'Dueño', pin: '1234' },
    });
    expect(setup.statusCode).toBe(201);
    const adminId = setup.json().user.id as string;
    adminToken = (await login(adminId, '1234')).token;

    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Ana', role: 'employee', pin: '5678' },
    });
    expect(created.statusCode).toBe(201);
    employeeToken = (await login(created.json().user.id, '5678')).token;
  });

  afterEach(() => app.close());

  async function login(userId: string, pin: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { userId, pin },
    });
    return res.json() as { token: string };
  }
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  it('sin sesión: 401', async () => {
    expect((await app.inject('/api/auth/me')).statusCode).toBe(401);
    expect((await app.inject('/test/sell')).statusCode).toBe(401);
  });

  it('el selector de usuarios es público y solo expone nombres', async () => {
    const res = await app.inject('/api/auth/users');
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toHaveLength(2);
    expect(JSON.stringify(res.json())).not.toMatch(/pin|hash/i);
  });

  it('empleado: permitido, requiere PIN de admin, o denegado según la matriz', async () => {
    expect((await app.inject({ url: '/test/sell', headers: as(employeeToken) })).statusCode).toBe(
      200,
    );

    const cancel = await app.inject({ url: '/test/cancel', headers: as(employeeToken) });
    expect(cancel.statusCode).toBe(403);
    expect(cancel.json().requiresAdminPin).toBe(true);

    const users = await app.inject({ url: '/api/users', headers: as(employeeToken) });
    expect(users.statusCode).toBe(403);
    expect(users.json().requiresAdminPin).toBe(false);
  });

  it('admin puede todo', async () => {
    expect((await app.inject({ url: '/test/cancel', headers: as(adminToken) })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ url: '/api/users', headers: as(adminToken) })).statusCode).toBe(200);
  });

  it('el empleado puede aprobar con PIN de admin', async () => {
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/admin-approval',
      headers: as(employeeToken),
      payload: { pin: '1234' },
    });
    expect(ok.json()).toMatchObject({ ok: true, approvedBy: { name: 'Dueño' } });
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/admin-approval',
      headers: as(employeeToken),
      payload: { pin: '9999' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('valida el cuerpo: PIN inválido da 400 en español', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: as(adminToken),
      payload: { name: 'X', role: 'employee', pin: '12' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('PIN');
  });

  it('logout invalida el token', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: as(employeeToken) });
    expect((await app.inject({ url: '/api/auth/me', headers: as(employeeToken) })).statusCode).toBe(
      401,
    );
  });

  it('setup responde 409 si ya está configurado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { tenantName: 'x', storeName: 'x', adminName: 'x', pin: '1111' },
    });
    expect(res.statusCode).toBe(409);
  });
});
