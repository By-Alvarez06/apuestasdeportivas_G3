import { validationError } from '../src/common/errors/domain-error';
import {
  type PayphoneConfirmation,
  PayphoneUnavailableError,
  type PrepareInput,
  type PrepareResult,
} from '../src/deposits/payphone.client';
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

/**
 * Payphone simulado. Por defecto aprueba lo que se preparó, con los mismos datos; `override` cambia la
 * respuesta de confirmación de una referencia (rechazo, monto alterado o caída del servicio).
 */
export class FakePayphoneClient {
  readonly prepared = new Map<string, PrepareInput>();
  readonly confirmCalls: { id: number; clientTxId: string }[] = [];
  private readonly overrides = new Map<string, Partial<PayphoneConfirmation> | 'unavailable'>();
  private nextTxId = 1000;

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    this.prepared.set(input.clientTransactionId, input);
    return { paymentUrl: `https://payphone.test/pagar/${input.clientTransactionId}` };
  }

  /** Lo que haría el navegador al volver de Payphone: un id de transacción para esa referencia. */
  pay(clientTransactionId: string): number {
    if (!this.prepared.has(clientTransactionId)) throw new Error('No se preparó ese pago');
    return ++this.nextTxId;
  }

  override(clientTransactionId: string, response: Partial<PayphoneConfirmation> | 'unavailable') {
    this.overrides.set(clientTransactionId, response);
  }

  async confirm(id: number, clientTxId: string): Promise<PayphoneConfirmation> {
    this.confirmCalls.push({ id, clientTxId });
    const override = this.overrides.get(clientTxId);
    if (override === 'unavailable') throw new PayphoneUnavailableError('simulado');
    const prepared = this.prepared.get(clientTxId);
    return {
      approved: prepared !== undefined,
      amount: prepared?.amount ?? 0,
      currency: 'USD',
      clientTransactionId: clientTxId,
      transactionId: id,
      payerDocument: '1104567890',
      payerPhone: '593987654321',
      ...override,
    };
  }

  reset(): void {
    this.prepared.clear();
    this.overrides.clear();
    this.confirmCalls.length = 0;
  }
}

export const BREACHED_PASSWORD = 'contrasena-filtrada';

/** Sin red: solo BREACHED_PASSWORD figura como filtrada. */
export class FakeBreachedPasswordChecker {
  async isBreached(password: string): Promise<boolean> {
    return password === BREACHED_PASSWORD;
  }
}
