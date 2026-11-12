import { createServer, type Server } from 'node:http';

/**
 * Payphone falso para la E2E de depósito: implementa Prepare y V2/Confirm con la forma real de sus
 * respuestas, y una "página de pago" que vuelve a la responseUrl como lo haría Payphone.
 * La API debe arrancar con PAYPHONE_BASE_URL=http://localhost:<puerto>.
 */
export const PAYPHONE_MOCK_PORT = Number(process.env.E2E_PAYPHONE_PORT ?? 8099);

interface Payment {
  amount: number;
  responseUrl: string;
  transactionId: number;
}

export function startPayphoneMock(): Promise<Server> {
  const payments = new Map<string, Payment>();
  // Ids únicos entre corridas: la API rechaza (con razón) un id de Payphone ya usado.
  let nextId = Date.now() % 1_000_000_000;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PAYPHONE_MOCK_PORT}`);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/api/button/Prepare') {
        const body = JSON.parse(raw) as {
          amount: number;
          clientTransactionId: string;
          responseUrl: string;
        };
        payments.set(body.clientTransactionId, {
          amount: body.amount,
          responseUrl: body.responseUrl,
          transactionId: ++nextId,
        });
        const pay = `http://localhost:${PAYPHONE_MOCK_PORT}/pagar?ref=${body.clientTransactionId}`;
        return json(200, { paymentId: `p${nextId}`, payWithPayPhone: pay, payWithCard: pay });
      }
      if (req.method === 'GET' && url.pathname === '/pagar') {
        const ref = url.searchParams.get('ref') ?? '';
        const payment = payments.get(ref);
        if (!payment) return json(404, { message: 'no existe' });
        res.writeHead(302, {
          Location: `${payment.responseUrl}?id=${payment.transactionId}&clientTransactionId=${ref}`,
        });
        return res.end();
      }
      if (req.method === 'POST' && url.pathname === '/api/button/V2/Confirm') {
        const { id, clientTxId } = JSON.parse(raw) as { id: number; clientTxId: string };
        const payment = payments.get(clientTxId);
        if (!payment || payment.transactionId !== id)
          return json(400, { message: 'La transacción no existe', errorCode: 20 });
        return json(200, {
          amount: payment.amount,
          clientTransactionId: clientTxId,
          statusCode: 3,
          transactionStatus: 'Approved',
          transactionId: id,
          document: '1104567890',
          phoneNumber: '593987654321',
          currency: 'USD',
        });
      }
      json(404, { message: 'ruta desconocida' });
    });
  });

  return new Promise((resolve) => server.listen(PAYPHONE_MOCK_PORT, () => resolve(server)));
}
