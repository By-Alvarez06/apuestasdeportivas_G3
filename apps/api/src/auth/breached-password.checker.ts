import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Consulta Have I Been Pwned con k-anonymity: solo viajan los 5 primeros caracteres del SHA-1, nunca
 * la contraseña. Si el servicio no responde, deja pasar (research.md §6): no bloquea registros.
 */
@Injectable()
export class BreachedPasswordChecker {
  private readonly logger = new Logger(BreachedPasswordChecker.name);

  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const [prefix, suffix] = [sha1.slice(0, 5), sha1.slice(5)];
    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.text())
        .split('\n')
        .some((line) => line.startsWith(`${suffix}:`) && !line.trim().endsWith(':0'));
    } catch (error) {
      this.logger.warn(`No se pudo consultar contraseñas filtradas: ${String(error)}`);
      return false;
    }
  }
}
