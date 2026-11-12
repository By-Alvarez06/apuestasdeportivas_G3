import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { type ApiErrorBody, ErrorCode } from '@apuestas/shared';
import { DomainError } from './domain-error';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
};

/** Todas las respuestas de error salen como `{ error: { code, message } }` (contracts/http-api.md). */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);
    res.status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ApiErrorBody] {
    if (exception instanceof DomainError) {
      return [exception.status, { error: { code: exception.code, message: exception.message } }];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? ErrorCode.INTERNAL_ERROR;
      return [status, { error: { code, message: messageOf(exception) } }];
    }
    // Nunca se filtra el detalle de un error inesperado al cliente.
    this.logger.error(exception);
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { error: { code: ErrorCode.INTERNAL_ERROR, message: 'Ocurrió un error inesperado.' } },
    ];
  }
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const { message } = response as { message?: string | string[] };
  if (Array.isArray(message)) return message.join('; ');
  return message ?? exception.message;
}
