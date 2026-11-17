import {
  PayphoneClient,
  type PayphoneConfirmation,
  type PrepareInput,
  type PrepareResult,
} from './payphone.client';

/** Proveedor local de pagos para desarrollo: nunca contacta a Payphone ni cobra dinero. */
export class SimulatedPayphoneClient extends PayphoneClient {
  private readonly payments = new Map<string, { id: number; amount: number }>();
  private nextId = Date.now() % 1_000_000_000;

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const id = ++this.nextId;
    this.payments.set(input.clientTransactionId, { id, amount: input.amount });
    const returnUrl = new URL(input.responseUrl);
    returnUrl.searchParams.set('id', String(id));
    returnUrl.searchParams.set('clientTransactionId', input.clientTransactionId);
    return { paymentUrl: returnUrl.toString() };
  }

  async confirm(id: number, clientTxId: string): Promise<PayphoneConfirmation> {
    const payment = this.payments.get(clientTxId);
    const approved = payment?.id === id;
    return {
      approved,
      amount: approved ? payment.amount : 0,
      currency: 'USD',
      clientTransactionId: clientTxId,
      transactionId: id,
      payerDocument: approved ? '0000000000' : null,
      payerPhone: approved ? '0000000000' : null,
    };
  }
}
