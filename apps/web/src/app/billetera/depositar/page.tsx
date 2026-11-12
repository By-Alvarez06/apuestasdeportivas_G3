'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { toCents, UserRole } from '@apuestas/shared';
import { AppShell, useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf, newIdempotencyKey } from '@/lib/api';
import { usd } from '@/lib/format';
import styles from '../forms.module.css';

const PRESETS = ['10.00', '20.00', '50.00', '100.00'];

/** "20" → "20.00"; null si no es un monto válido. */
function normalize(text: string): string | null {
  const value = text.trim().replace(',', '.');
  try {
    const cents = toCents(value);
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function Deposit() {
  const { me } = useSession();
  const router = useRouter();
  const [amount, setAmount] = useState('20.00');
  // Una clave por intención: si la red falla y se reintenta el mismo monto, no se duplica el depósito.
  const [intent, setIntent] = useState(() => ({ key: newIdempotencyKey(), amount: '20.00' }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const normalized = normalize(amount);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!normalized) return setError('Escribe un monto válido, por ejemplo 20.00.');
    const key = intent.amount === normalized ? intent.key : newIdempotencyKey();
    setIntent({ key, amount: normalized });
    setBusy(true);
    setError('');
    try {
      const res = await api<{ id: string; paymentUrl: string | null }>('/deposits', {
        method: 'POST',
        body: { amount: normalized },
        idempotencyKey: key,
      });
      if (res.paymentUrl) window.location.assign(res.paymentUrl);
      else router.push(`/billetera/depositos/${res.id}`);
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  }

  if (me.status !== 'ACTIVE')
    return (
      <Notice tone="warning">
        Confirma tu correo antes de depositar. <Link href="/verificar-correo">Pedir enlace</Link>
      </Notice>
    );

  return (
    <div className={styles.page}>
      <h1>Depositar</h1>
      <p className="muted">
        Pagas en Payphone (entorno de pruebas). El saldo sube cuando Payphone nos confirma el pago,
        no antes.
      </p>
      <form className="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        <fieldset className={styles.presets}>
          <legend className="visually-hidden">Montos sugeridos</legend>
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={styles.preset}
              aria-pressed={normalized === p}
              onClick={() => setAmount(p)}
            >
              {usd(p)}
            </button>
          ))}
        </fieldset>
        <div className="field">
          <label htmlFor="amount">Monto en USD</label>
          <input
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!normalized}
            aria-describedby="amount-hint"
            required
          />
          <span id="amount-hint" className="hint">
            Entre $1.00 y $1,000.00 por depósito.
          </span>
        </div>
        <button className="button" type="submit" disabled={busy || !normalized}>
          {busy ? 'Abriendo Payphone…' : `Depositar ${normalized ? usd(normalized) : ''}`}
        </button>
      </form>
      <p>
        <Link href="/billetera">Volver a la billetera</Link>
      </p>
    </div>
  );
}

export default function DepositPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <Deposit />
    </AppShell>
  );
}
