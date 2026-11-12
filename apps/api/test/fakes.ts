import { validationError } from '../src/common/errors/domain-error';
import type { MailMessage } from '../src/mail/mail.service';

/** Bandeja en memoria: las pruebas leen los correos sin SMTP. */
export class FakeMailService {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  to(email: string): MailMessage[] {
    return this.sent.filter((m) => m.to === email);
  }

  /** Token del último enlace enviado a `email` (`…?token=XYZ`). */
  lastToken(email: string): string {
    const text = this.to(email).at(-1)?.text ?? '';
    const token = /token=([\w-]+)/.exec(text)?.[1];
    if (!token) throw new Error(`No hay enlace con token para ${email}`);
    return token;
  }

  clear(): void {
    this.sent.length = 0;
  }
}

export const INVALID_CAPTCHA = 'captcha-invalido';

/** Aprueba todo token salvo INVALID_CAPTCHA; nunca llama a Turnstile. */
export class FakeCaptchaService {
  async verify(token: string): Promise<void> {
    if (token === INVALID_CAPTCHA)
      throw validationError('No pudimos verificar que no eres un bot.');
  }
}

export const BREACHED_PASSWORD = 'contrasena-filtrada';

/** Sin red: solo BREACHED_PASSWORD figura como filtrada. */
export class FakeBreachedPasswordChecker {
  async isBreached(password: string): Promise<boolean> {
    return password === BREACHED_PASSWORD;
  }
}
