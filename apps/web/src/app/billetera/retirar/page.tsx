'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { UserRole, WithdrawalStatus } from '@apuestas/shared';
import { AppShell, useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf, newIdempotencyKey } from '@/lib/api';
import { dateTime, usd } from '@/lib/format';
import listStyles from '../billetera.module.css';
import styles from '../forms.module.css';

interface Withdrawal {
  id: string;
  amount: string;
  status: WithdrawalStatus;
  createdAt: string;
}

const STATUS_LABEL: Record<WithdrawalStatus, string> = {
  [WithdrawalStatus.PROCESSING]: 'En proceso',
  [WithdrawalStatus.PENDING_APPROVAL]: 'En revisión',
  [WithdrawalStatus.APPROVED]: 'Aprobado',
  [WithdrawalStatus.PAID]: 'Pagado',
  [WithdrawalStatus.REJECTED]: 'Rechazado, el monto volvió a tu saldo',
};

function Withdraw() {
  const { me } = useSession();
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [key, setKey] = useState(newIdempotencyKey);
  const [result, setResult] = useState<Withdrawal | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: Withdrawal[] }>('/withdrawals')).items);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const w = await api<Withdrawal>('/withdrawals', {
        method: 'POST',
        idempotencyKey: key,
        body: {
          amount: String(data.get('amount') ?? '')
            .trim()
            .replace(',', '.'),
          destinationDocument: String(data.get('document') ?? '').trim(),
          destinationPhone: String(data.get('phone') ?? '').replace(/\D/g, ''),
          totpCode: String(data.get('code') ?? '').trim(),
        },
      });
      setResult(w);
      setKey(newIdempotencyKey());
      form.reset();
      await load();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!me.twoFactorEnabled)
    return (
      <div className={styles.page}>
        <h1>Retirar</h1>
        <Notice tone="warning">
          Para retirar necesitas la verificación en dos pasos.{' '}
          <Link href="/cuenta/seguridad">Configurarla ahora</Link>
        </Notice>
      </div>
    );

  return (
    <>
      <div className={styles.page}>
        <h1>Retirar</h1>
        <p className="muted">
          Solo puedes retirar saldo real, a la misma persona y teléfono con los que depositaste en
          Payphone. Los retiros de más de $200.00 los revisa un administrador.
        </p>
        <form className="form" onSubmit={onSubmit}>
          {error && <Notice tone="error">{error}</Notice>}
          {result && (
            <Notice>
              Retiro de {usd(result.amount)}: {STATUS_LABEL[result.status].toLowerCase()}.
            </Notice>
          )}
          <div className="field">
            <label htmlFor="amount">Monto en USD</label>
            <input id="amount" name="amount" inputMode="decimal" autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="document">Cédula o RUC del titular</label>
            <input id="document" name="document" inputMode="numeric" autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="phone">Teléfono del titular</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="593987654321"
              aria-describedby="phone-hint"
              required
            />
            <span id="phone-hint" className="hint">
              Con código de país, como lo registró Payphone.
            </span>
          </div>
          <div className="field">
            <label htmlFor="code">Código de verificación</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="code-hint"
              required
            />
            <span id="code-hint" className="hint">
              Los 6 dígitos de tu app, o uno de tus códigos de recuperación.
            </span>
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Solicitar retiro'}
          </button>
        </form>
      </div>

      <section aria-labelledby="mis-retiros" className="stack">
        <h2 id="mis-retiros">Tus retiros</h2>
        {items.length === 0 ? (
          <p className="muted">Todavía no has pedido retiros.</p>
        ) : (
          <ol className={listStyles.list}>
            {items.map((w) => (
              <li key={w.id} className={listStyles.row}>
                <span className={listStyles.what}>
                  {STATUS_LABEL[w.status]}
                  <small>{dateTime(w.createdAt)}</small>
                </span>
                <span className={listStyles.amount}>{usd(w.amount)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export default function WithdrawPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <Withdraw />
    </AppShell>
  );
}
