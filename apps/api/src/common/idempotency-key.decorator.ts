import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { validationError } from './errors/domain-error';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Header `Idempotency-Key` obligatorio en rutas que mueven dinero (FR-017). Solo valida el formato:
 * la deduplicación la hace el libro contable con su clave única, que el servicio prefija con el
 * usuario para que dos usuarios no choquen.
 */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const key = ctx.switchToHttp().getRequest<Request>().get('idempotency-key');
  if (!key || !KEY_PATTERN.test(key))
    throw validationError(
      'Falta el header Idempotency-Key (8 a 128 caracteres: letras, números, _ . : -).',
    );
  return key;
});
