import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validationError } from '../common/errors/domain-error';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Verificación anti-bots de Cloudflare Turnstile en el servidor (FR-005). Si Turnstile no responde, rechaza. */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(token: string, ip: string): Promise<void> {
    const body = new URLSearchParams({
      secret: this.config.getOrThrow<string>('TURNSTILE_SECRET'),
      response: token,
      remoteip: ip,
    });
    let success = false;
    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      success = ((await res.json()) as { success?: boolean }).success === true;
    } catch (error) {
      this.logger.warn(`Turnstile no respondió: ${String(error)}`);
    }
    if (!success)
      throw validationError(
        'No pudimos verificar que no eres un bot. Recarga la página e inténtalo de nuevo.',
      );
  }
}
