import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../auth/routes.js';
import type { AuthService } from '../auth/service.js';
import { badRequest } from '../../errors.js';
import {
  buildTemplate,
  CSV_MIME,
  formatFromContentType,
  XLSX_MIME,
  type FileFormat,
} from './file.js';
import type { ImportService } from './service.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fileFrom(req: FastifyRequest): Buffer {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw badRequest('empty_file', 'No se recibió ningún archivo.');
  }
  return req.body;
}

export function registerImportRoutes(
  app: FastifyInstance,
  auth: AuthService,
  importer: ImportService,
): void {
  // El archivo llega como cuerpo binario (Content-Type: text/csv o .xlsx), sin multipart.
  for (const type of [CSV_MIME, XLSX_MIME]) {
    app.addContentTypeParser(
      type,
      { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES },
      (_req, body, done) => done(null, body),
    );
  }

  const guard = requirePermission(auth, 'catalog.manage');

  app.get('/api/import/template', { preHandler: guard }, async (req, reply: FastifyReply) => {
    const { format } = req.query as { format?: string };
    if (format !== undefined && format !== 'xlsx' && format !== 'csv') {
      throw badRequest('unsupported_format', 'El formato debe ser xlsx o csv.');
    }
    const fileFormat: FileFormat = format === 'csv' ? 'csv' : 'xlsx';
    return reply
      .header('content-type', fileFormat === 'csv' ? `${CSV_MIME}; charset=utf-8` : XLSX_MIME)
      .header('content-disposition', `attachment; filename="plantilla-inventario.${fileFormat}"`)
      .send(await buildTemplate(fileFormat));
  });

  app.post('/api/import/preview', { preHandler: guard }, async (req) => {
    const format = formatFromContentType(req.headers['content-type']);
    return importer.preview(req.user!, fileFrom(req), format);
  });

  app.post('/api/import/apply', { preHandler: guard }, async (req, reply) => {
    const format = formatFromContentType(req.headers['content-type']);
    const result = await importer.apply(req.user!, fileFrom(req), format);
    // Con errores no se guarda nada: 422 con el detalle por fila.
    return reply.code(result.ok ? 200 : 422).send(result);
  });
}
