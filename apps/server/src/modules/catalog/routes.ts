import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authGuard, requirePermission } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import type { CatalogService } from './service.js';

const name = z.string().trim().min(1, 'El nombre es obligatorio.').max(120);
const cents = z.number().int('El precio debe estar en centavos enteros.').min(0);
const code = z
  .string()
  .trim()
  .min(1, 'El código es obligatorio.')
  .max(64)
  .regex(/^\S+$/, 'El código no puede tener espacios.');

const variantBody = z.object({
  name: name.nullish(),
  priceCents: cents.nullish(),
  costCents: cents.nullish(),
  barcodes: z.array(code).optional(),
});
const productBody = z.object({
  name,
  categoryId: z.string().nullish(),
  priceCents: cents,
  controlsInventory: z.boolean().optional(),
  variants: z.array(variantBody).optional(),
});
const productPatch = z
  .object({
    name,
    categoryId: z.string().nullable(),
    priceCents: cents,
    controlsInventory: z.boolean(),
    active: z.boolean(),
  })
  .partial();
const variantPatch = z
  .object({
    name: name.nullable(),
    priceCents: cents.nullable(),
    costCents: cents.nullable(),
    active: z.boolean(),
  })
  .partial();
const idParams = z.object({ id: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  reply.code(400).send({ error: result.error.issues[0]?.message ?? 'Datos inválidos.' });
  return undefined;
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  auth: AuthService,
  catalog: CatalogService,
): void {
  const read = authGuard(auth);
  const write = requirePermission(auth, 'catalog.manage');

  app.get('/api/categories', { preHandler: read }, async (req) => ({
    categories: catalog.listCategories(req.user!),
  }));
  app.post('/api/categories', { preHandler: write }, async (req, reply) => {
    const body = parse(z.object({ name }), req.body, reply);
    if (body) return reply.code(201).send(catalog.createCategory(req.user!, body.name));
  });
  app.patch('/api/categories/:id', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(z.object({ name }), req.body, reply);
    if (params && body) return catalog.renameCategory(req.user!, params.id, body.name);
  });

  app.get('/api/products', { preHandler: read }, async (req, reply) => {
    const query = parse(
      z.object({
        categoryId: z.string().optional(),
        includeInactive: z.enum(['true', 'false']).optional(),
      }),
      req.query,
      reply,
    );
    if (!query) return;
    return {
      products: catalog.listProducts(req.user!, {
        categoryId: query.categoryId,
        includeInactive: query.includeInactive === 'true',
      }),
    };
  });
  app.get('/api/products/:id', { preHandler: read }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) return catalog.getProduct(req.user!, params.id);
  });
  app.post('/api/products', { preHandler: write }, async (req, reply) => {
    const body = parse(productBody, req.body, reply);
    if (body) return reply.code(201).send(catalog.createProduct(req.user!, body));
  });
  app.patch('/api/products/:id', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(productPatch, req.body, reply);
    if (params && body) return catalog.updateProduct(req.user!, params.id, body);
  });

  app.post('/api/products/:id/variants', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(variantBody, req.body, reply);
    if (params && body) return reply.code(201).send(catalog.addVariant(req.user!, params.id, body));
  });
  app.patch('/api/variants/:id', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(variantPatch, req.body, reply);
    if (params && body) return catalog.updateVariant(req.user!, params.id, body);
  });
  app.post('/api/variants/:id/barcodes', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(z.object({ code }), req.body, reply);
    if (params && body) {
      return reply.code(201).send(catalog.addBarcode(req.user!, params.id, body.code));
    }
  });
  app.delete('/api/barcodes/:id', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) return catalog.removeBarcode(req.user!, params.id);
  });
}
