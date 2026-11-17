import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validationError } from '../common/errors/domain-error';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CLOUDFLARE_TEST_SECRET = '1x0000000000000000000000000000000AA';

/** Verificación anti-bots de Cloudflare Turnstile en el servidor (FR-005). Si Turnstile no responde, rechaza. */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(token: string, ip: string): Promise<void> {
    const secret = this.config.getOrThrow<string>('TURNSTILE_SECRET');
    // Cloudflare's documented test key is designed to always pass. In local development,
    // honor that behavior without requiring an internet connection to Siteverify.
    if (this.config.get<string>('NODE_ENV') === 'development' && secret === CLOUDFLARE_TEST_SECRET)
      return;

    const body = new URLSearchParams({
      secret,
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
