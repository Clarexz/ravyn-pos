import { accessFor, ROLES, type Permission } from '@pos/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isValidPin } from './pin.js';
import { AuthError, type AuthService, type SessionUser } from './service.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Presente solo cuando la app se construye con base de datos. */
    auth: AuthService;
  }
  interface FastifyRequest {
    user?: SessionUser;
    sessionToken?: string;
  }
}

const pinSchema = z.string().refine(isValidPin, 'El PIN debe tener de 4 a 6 dígitos.');
const nameSchema = z.string().trim().min(1, 'El nombre es obligatorio.').max(80);

const setupBody = z.object({
  tenantName: nameSchema,
  storeName: nameSchema,
  adminName: nameSchema,
  pin: pinSchema,
});
const loginBody = z.object({ userId: z.string().min(1), pin: z.string() });
const createUserBody = z.object({ name: nameSchema, role: z.enum(ROLES), pin: pinSchema });

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

/** Exige sesión válida; deja `req.user` listo. */
export function authGuard(auth: AuthService) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    const user = auth.authenticate(token);
    if (!user) return reply.code(401).send({ error: 'Inicia sesión para continuar.' });
    req.user = user;
    req.sessionToken = token;
  };
}

/**
 * Exige sesión y permiso. Si el empleado solo puede con aprobación de admin ('admin_pin'),
 * responde 403 con `requiresAdminPin` para que la interfaz pida el PIN.
 */
export function requirePermission(auth: AuthService, permission: Permission) {
  const guard = authGuard(auth);
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const denied = await guard(req, reply);
    if (denied) return denied;
    const access = accessFor(req.user!.role, permission);
    if (access === 'allow') return;
    return reply.code(403).send({
      error: 'No tienes permiso para esta acción.',
      requiresAdminPin: access === 'admin_pin',
    });
  };
}

function sendAuthError(reply: FastifyReply, err: unknown) {
  if (err instanceof AuthError) {
    const status = err.code === 'locked' ? 423 : err.code === 'setup_done' ? 409 : 401;
    return reply
      .code(status)
      .send({ error: err.message, code: err.code, retryAfterMs: err.retryAfterMs });
  }
  throw err;
}

function parse<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  reply.code(400).send({ error: result.error.issues[0]?.message ?? 'Datos inválidos.' });
  return undefined;
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService): void {
  app.get('/api/setup/status', async () => ({ needsSetup: auth.needsSetup() }));

  app.post('/api/setup', async (req, reply) => {
    const body = parse(setupBody, req.body, reply);
    if (!body) return;
    try {
      const admin = await auth.setup(body);
      return reply.code(201).send({ user: admin });
    } catch (err) {
      return sendAuthError(reply, err);
    }
  });

  // Lista para el selector de usuario en la pantalla de PIN. Solo nombres.
  app.get('/api/auth/users', async () => ({ users: auth.listActiveUsers() }));

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(loginBody, req.body, reply);
    if (!body) return;
    try {
      return await auth.login(body.userId, body.pin);
    } catch (err) {
      return sendAuthError(reply, err);
    }
  });

  const guard = authGuard(auth);

  app.post('/api/auth/logout', { preHandler: guard }, async (req) => {
    auth.logout(req.sessionToken!);
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: guard }, async (req) => ({ user: req.user }));

  app.post('/api/auth/admin-approval', { preHandler: guard }, async (req, reply) => {
    const body = parse(z.object({ pin: z.string() }), req.body, reply);
    if (!body) return;
    try {
      const admin = await auth.approveWithAdminPin(req.user!, body.pin);
      if (!admin) return reply.code(401).send({ error: 'PIN de administrador incorrecto.' });
      return { ok: true, approvedBy: { id: admin.id, name: admin.name } };
    } catch (err) {
      return sendAuthError(reply, err);
    }
  });

  app.get('/api/users', { preHandler: requirePermission(auth, 'users.manage') }, async () => ({
    users: auth.listActiveUsers(),
  }));

  app.post(
    '/api/users',
    { preHandler: requirePermission(auth, 'users.manage') },
    async (req, reply) => {
      const body = parse(createUserBody, req.body, reply);
      if (!body) return;
      const user = await auth.createUser(req.user!, body);
      return reply.code(201).send({ user });
    },
  );
}
