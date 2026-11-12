import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { validationError } from '../common/errors/domain-error';
import { BreachedPasswordChecker } from './breached-password.checker';

// Parámetros mínimos recomendados por OWASP para Argon2id.
const ARGON_OPTIONS = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MIN_LENGTH = 10;
// Tope para que nadie haga trabajar a Argon2 con contraseñas de megabytes.
const MAX_LENGTH = 128;

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  constructor(private readonly breached: BreachedPasswordChecker) {}

  /** Política de FR-002: 10 a 128 caracteres y que no aparezca en filtraciones conocidas. */
  async assertAcceptable(password: string): Promise<void> {
    if (password.length < MIN_LENGTH || password.length > MAX_LENGTH)
      throw validationError(
        `La contraseña debe tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`,
      );
    if (await this.breached.isBreached(password))
      throw validationError(
        'Esa contraseña aparece en filtraciones de datos conocidas. Elige otra distinta.',
      );
  }

  hash(password: string): Promise<string> {
    return hash(password, ARGON_OPTIONS);
  }

  /** Con `passwordHash` null compara contra un hash ficticio: tarda lo mismo y no revela si la cuenta existe. */
  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (password.length > MAX_LENGTH) return false;
    if (passwordHash === null) {
      this.dummyHash ??= this.hash('cuenta-inexistente-para-igualar-tiempos');
      await verify(await this.dummyHash, password);
      return false;
    }
    return verify(passwordHash, password);
  }
}
