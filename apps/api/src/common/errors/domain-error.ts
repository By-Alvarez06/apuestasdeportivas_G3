import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@apuestas/shared';

/** Error de negocio con código estable para el cliente. El filtro global lo convierte en respuesta. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: HttpStatus,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export const unauthenticated = (message = 'Inicia sesión para continuar.') =>
  new DomainError(ErrorCode.UNAUTHENTICATED, message, HttpStatus.UNAUTHORIZED);

export const forbidden = (message = 'No tienes permiso para esta acción.') =>
  new DomainError(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);

export const notFound = (message = 'No encontrado.') =>
  new DomainError(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);

export const validationError = (message: string) =>
  new DomainError(ErrorCode.VALIDATION_ERROR, message, HttpStatus.BAD_REQUEST);
