import { ConfigService } from '@nestjs/config';
import approved from './__fixtures__/confirm-approved.json';
import canceled from './__fixtures__/confirm-canceled.json';
import notFound from './__fixtures__/confirm-not-found.json';
import prepared from './__fixtures__/prepare.json';
import { HttpPayphoneClient, PayphoneUnavailableError } from './payphone.client';

// Contrato con Payphone (T040): respuestas grabadas de docs.payphone.app (botón de pago por redirección).
describe('HttpPayphoneClient', () => {
  const config = new ConfigService({
    PAYPHONE_TOKEN: 'token-de-prueba',
    PAYPHONE_STORE_ID: 'tienda-1',
  });
  const client = new HttpPayphoneClient(config);
  let fetchMock: jest.SpyInstance;

  const reply = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('prepara el pago con montos en centavos que suman el total', async () => {
    reply(200, prepared);
    const result = await client.prepare({
      amount: 2000,
      clientTransactionId: 'DEP-0123456789abcdef0123',
      responseUrl: 'http://localhost:3000/api/payments/payphone/return',
      cancellationUrl: 'http://localhost:3000/billetera/depositos/1',
      reference: 'Depósito',
    });

    expect(result.paymentUrl).toBe(prepared.payWithCard);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pay.payphonetodoesposible.com/api/button/Prepare');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-de-prueba');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 2000,
      amountWithoutTax: 2000,
      currency: 'USD',
      clientTransactionId: 'DEP-0123456789abcdef0123',
      storeId: 'tienda-1',
      reference: 'Depósito',
      responseUrl: 'http://localhost:3000/api/payments/payphone/return',
      cancellationUrl: 'http://localhost:3000/billetera/depositos/1',
    });
  });

  it('confirma un pago aprobado y devuelve los datos a verificar', async () => {
    reply(200, approved);
    const result = await client.confirm(23178284, 'DEP-0123456789abcdef0123');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pay.payphonetodoesposible.com/api/button/V2/Confirm');
    expect(JSON.parse(init.body as string)).toEqual({
      id: 23178284,
      clientTxId: 'DEP-0123456789abcdef0123',
    });
    expect(result).toEqual({
      approved: true,
      amount: 2000,
      currency: 'USD',
      clientTransactionId: 'DEP-0123456789abcdef0123',
      transactionId: 23178284,
      payerDocument: '1234567890',
      payerPhone: '593999999999',
    });
  });

  it('un pago cancelado no está aprobado', async () => {
    reply(200, canceled);
    expect((await client.confirm(23178284, 'DEP-0123456789abcdef0123')).approved).toBe(false);
  });

  it('una transacción inexistente no está aprobada', async () => {
    reply(400, notFound);
    expect((await client.confirm(1, 'DEP-x')).approved).toBe(false);
  });

  it('si Payphone no responde, lo distingue de un rechazo', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.confirm(1, 'DEP-x')).rejects.toBeInstanceOf(PayphoneUnavailableError);
    reply(500, { message: 'error' });
    await expect(client.confirm(1, 'DEP-x')).rejects.toBeInstanceOf(PayphoneUnavailableError);
  });
});
