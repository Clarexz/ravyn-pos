import { PRINT_COLORS, PRINT_SIZES } from '@pos/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authGuard, requirePermission } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import type { ConsumptionService } from './service.js';

const printPriceBody = z.object({
  color: z.enum(PRINT_COLORS),
  size: z.enum(PRINT_SIZES),
  priceCents: z.number().int('El precio debe estar en centavos enteros.').min(0),
});
const recipeBody = z.object({
  lines: z.array(
    z.object({
      inputVariantId: z.string().min(1),
      quantity: z
        .number()
        .int('La cantidad debe ser un entero.')
        .positive('La cantidad debe ser mayor a 0.'),
    }),
  ),
});
const idParams = z.object({ id: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, data: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  reply.code(400).send({ error: result.error.issues[0]?.message ?? 'Datos inválidos.' });
  return undefined;
}

export function registerConsumptionRoutes(
  app: FastifyInstance,
  auth: AuthService,
  consumption: ConsumptionService,
): void {
  const read = authGuard(auth);
  const write = requirePermission(auth, 'catalog.manage');

  app.get('/api/print-prices', { preHandler: read }, async (req) => ({
    prices: consumption.listPrintPrices(req.user!),
  }));
  app.put('/api/print-prices', { preHandler: write }, async (req, reply) => {
    const body = parse(printPriceBody, req.body, reply);
    if (body) return consumption.setPrintPrice(req.user!, body);
  });

  // Recetas: de un tipo de impresión o de una variante de servicio.
  app.get('/api/print-prices/:id/recipe', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) {
      return { lines: consumption.getRecipe(req.user!, { printPriceId: params.id }) };
    }
  });
  app.put('/api/print-prices/:id/recipe', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(recipeBody, req.body, reply);
    if (params && body) {
      return { lines: consumption.setRecipe(req.user!, { printPriceId: params.id }, body.lines) };
    }
  });
  app.get('/api/variants/:id/recipe', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    if (params) {
      return { lines: consumption.getRecipe(req.user!, { serviceVariantId: params.id }) };
    }
  });
  app.put('/api/variants/:id/recipe', { preHandler: write }, async (req, reply) => {
    const params = parse(idParams, req.params, reply);
    const body = parse(recipeBody, req.body, reply);
    if (params && body) {
      return {
        lines: consumption.setRecipe(req.user!, { serviceVariantId: params.id }, body.lines),
      };
    }
  });
}
