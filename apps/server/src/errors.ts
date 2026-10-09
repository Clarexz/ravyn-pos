/** Error de negocio con código estable y estado HTTP. `app.ts` lo traduce a respuesta. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const NOT_FOUND = 404;
const CONFLICT = 409;
const BAD_REQUEST = 400;

export const notFound = (code: string, message: string) =>
  new DomainError(code, message, NOT_FOUND);
export const conflict = (code: string, message: string) => new DomainError(code, message, CONFLICT);
export const badRequest = (code: string, message: string) =>
  new DomainError(code, message, BAD_REQUEST);
