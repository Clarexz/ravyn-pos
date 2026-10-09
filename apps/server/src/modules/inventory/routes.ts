import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authGuard, requirePermission } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import type { InventoryService } from './service.js';

const idParams = z.object({ id: z.string().min(1) });
const receiveBody = z.object({
  quantity: z
    .number()
    .int('La cantidad debe ser un entero.')
    .positive('La cantidad debe ser mayor a 0.'),
  reason: z.string().trim().max(200).optional(),
});
const adjustBody = z.object({
  delta: z
    .number()
    .int('La cantidad debe ser un entero.')
    .refine((n) => n !== 0, 'El ajuste no puede ser 0.'),
  reason: z.string().trim().min(1, 'El motivo es obligatorio.').max(200),
});

function parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  reply.code(400).send({ error: result.error.issues[0]?.message ?? 'Datos inválidos.' });
  return undefined;
}

export function registerInventoryRoutes(
  app: FastifyInstance,
  auth: AuthService,
  inventory: InventoryService,
): void {
  const read = authGuard(auth);
  const write = requirePermission(auth, 'inventory.adjust');

  app.get('/api/inventory/stock', { preHandler: read }, async (req) => ({
    stock: inventory.listStock(req.user!),
  }));

  app.get('/api/variants/:id/stock', { preHandler: read }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) return { stock: inventory.getStock(req.user!, params.id) };
  });

  app.get('/api/variants/:id/movements', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) return { movements: inventory.history(req.user!, params.id) };
  });

  app.post('/api/variants/:id/receive', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(receiveBody, req.body, reply);
    if (params && body) {
      return reply
        .code(201)
        .send({ stock: inventory.receive(req.user!, params.id, body.quantity, body.reason) });
    }
  });

  app.post('/api/variants/:id/adjust', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(adjustBody, req.body, reply);
    if (params && body) {
      return reply
        .code(201)
        .send({ stock: inventory.adjust(req.user!, params.id, body.delta, body.reason) });
    }
  });
}
