import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PrepareInput {
  /** Centavos. */
  amount: number;
  clientTransactionId: string;
  responseUrl: string;
  cancellationUrl: string;
  reference: string;
}

export interface PrepareResult {
  paymentUrl: string;
}

/** Lo que el sistema necesita de la respuesta de Confirm para decidir si acredita (FR-023). */
export interface PayphoneConfirmation {
  approved: boolean;
  amount: number;
  currency: string;
  clientTransactionId: string;
  transactionId: number;
  payerDocument: string | null;
  payerPhone: string | null;
}

/** Payphone no respondió o falló: no es un rechazo, se puede reintentar. */
export class PayphoneUnavailableError extends Error {}

/** Puerto hacia Payphone; las pruebas lo reemplazan por un doble. */
export abstract class PayphoneClient {
  abstract prepare(input: PrepareInput): Promise<PrepareResult>;
  abstract confirm(id: number, clientTxId: string): Promise<PayphoneConfirmation>;
}

const DEFAULT_BASE_URL = 'https://pay.payphonetodoesposible.com';
const APPROVED = 3;
const RETRYABLE_STATUS = new Set([401, 403, 408, 429]);

/** Botón de pago por redirección (docs.payphone.app/boton-de-pago-por-redireccion), modo sandbox. */
@Injectable()
export class HttpPayphoneClient extends PayphoneClient {
  private readonly logger = new Logger(HttpPayphoneClient.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.baseUrl = config.get<string>('PAYPHONE_BASE_URL', DEFAULT_BASE_URL);
  }

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const { status, body } = await this.post('/api/button/Prepare', {
      // Sin impuestos: todo el monto va en amountWithoutTax y la suma cuadra con amount.
      amount: input.amount,
      amountWithoutTax: input.amount,
      currency: 'USD',
      clientTransactionId: input.clientTransactionId,
      storeId: this.config.get<string>('PAYPHONE_STORE_ID'),
      reference: input.reference,
      responseUrl: input.responseUrl,
      cancellationUrl: input.cancellationUrl,
    });
    const url = (body as { payWithCard?: unknown }).payWithCard;
    if (status !== 200 || typeof url !== 'string')
      throw new PayphoneUnavailableError(`Prepare respondió ${status}`);
    return { paymentUrl: url };
  }

  async confirm(id: number, clientTxId: string): Promise<PayphoneConfirmation> {
    const { status, body } = await this.post('/api/button/V2/Confirm', { id, clientTxId });
    // Solo una respuesta de Payphone sobre el pago (200, o 400 "transacción inexistente") decide si está
    // aprobado. 5xx, credenciales (401/403), tiempo agotado (408) o límite (429) no dicen nada del pago.
    if (status >= 500 || RETRYABLE_STATUS.has(status))
      throw new PayphoneUnavailableError(`Confirm respondió ${status}`);
    const r = body as Record<string, unknown>;
    return {
      approved: status === 200 && r.statusCode === APPROVED && r.transactionStatus === 'Approved',
      amount: typeof r.amount === 'number' ? r.amount : 0,
      currency: typeof r.currency === 'string' ? r.currency : '',
      clientTransactionId: typeof r.clientTransactionId === 'string' ? r.clientTransactionId : '',
      transactionId: typeof r.transactionId === 'number' ? r.transactionId : id,
      payerDocument: typeof r.document === 'string' ? r.document : null,
      payerPhone: typeof r.phoneNumber === 'string' ? r.phoneNumber : null,
    };
  }

  private async post(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow<string>('PAYPHONE_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (error) {
      this.logger.warn(`Payphone ${path} no respondió: ${String(error)}`);
      throw new PayphoneUnavailableError(String(error));
    }
  }
}
