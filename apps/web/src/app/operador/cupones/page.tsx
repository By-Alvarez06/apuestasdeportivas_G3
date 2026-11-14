'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { COUPON_TYPE_LABEL } from '@/lib/bets';
import { dateTime, usd } from '@/lib/format';
import styles from './cupones.module.css';

type CouponType = keyof typeof COUPON_TYPE_LABEL;

interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  percent: number | null;
  amount: string | null;
  maxBonus: string | null;
  maxBoost: string | null;
  startsAt: string;
  endsAt: string;
  totalLimit: number;
  redeemed: number;
  status: 'ACTIVE' | 'PAUSED';
}

/** "2026-11-20T18:30" (input datetime-local) en hora local → ISO. */
const toIso = (local: string) => new Date(local).toISOString();
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function describe(c: Coupon): string {
  switch (c.type) {
    case 'DEPOSIT_BONUS':
      return `${c.percent} % del depósito, hasta ${usd(c.maxBonus ?? '0.00')}`;
    case 'FREE_BET':
      return `Apuesta gratis de ${usd(c.amount ?? '0.00')}`;
    case 'ODDS_BOOST':
      return `+${c.percent} % de cuota${c.maxBoost ? `, hasta +${c.maxBoost}` : ''}`;
  }
}

function Coupons() {
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setCoupons(await api<Coupon[]>('/operator/coupons'));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(c: Coupon) {
    try {
      await api(`/operator/coupons/${c.id}/${c.status === 'ACTIVE' ? 'pause' : 'resume'}`, {
        method: 'POST',
      });
      await load();
    } catch (e) {
      setError(messageOf(e));
    }
  }

  return (
    <div className={styles.page}>
      <h1>Cupones</h1>
      <CreateCoupon onCreated={load} />

      <section aria-labelledby="lista" className={styles.group}>
        <h2 id="lista">Cupones creados</h2>
        {error && <Notice tone="error">{error}</Notice>}
        {coupons === null && !error && <p role="status">Cargando cupones…</p>}
        {coupons?.length === 0 && <p className="muted">Todavía no hay cupones.</p>}
        <ul className={styles.list}>
          {coupons?.map((c) => (
            <li key={c.id} className={styles.item} data-status={c.status}>
              <div className={styles.itemHead}>
                <strong className={styles.code}>{c.code}</strong>
                <span>{COUPON_TYPE_LABEL[c.type]}</span>
              </div>
              <p>{describe(c)}</p>
              <p className="muted">
                {c.redeemed} de {c.totalLimit} canjes, vigente del {dateTime(c.startsAt)} al{' '}
                {dateTime(c.endsAt)}
              </p>
              <button type="button" className="button-quiet" onClick={() => toggle(c)}>
                {c.status === 'ACTIVE' ? `Pausar ${c.code}` : `Reanudar ${c.code}`}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">
          Un cupón no se edita una vez creado: si hay que cambiarlo, páusalo y crea otro.
        </p>
      </section>
    </div>
  );
}

function CreateCoupon({ onCreated }: { onCreated: () => void }) {
  const id = useId();
  const [type, setType] = useState<CouponType>('DEPOSIT_BONUS');
  const [form, setForm] = useState(() => ({
    code: '',
    percent: '50',
    amount: '5.00',
    maxBonus: '20.00',
    maxBoost: '',
    startsAt: localInput(new Date()),
    endsAt: localInput(new Date(Date.now() + 7 * 24 * 3_600_000)),
    totalLimit: '100',
  }));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const byType =
      type === 'DEPOSIT_BONUS'
        ? { percent: Number(form.percent), maxBonus: form.maxBonus }
        : type === 'FREE_BET'
          ? { amount: form.amount }
          : { percent: Number(form.percent), ...(form.maxBoost && { maxBoost: form.maxBoost }) };
    try {
      await api('/operator/coupons', {
        method: 'POST',
        body: {
          code: form.code,
          type,
          startsAt: toIso(form.startsAt),
          endsAt: toIso(form.endsAt),
          totalLimit: Number(form.totalLimit),
          ...byType,
        },
      });
      setMessage({ tone: 'info', text: `Cupón ${form.code.toUpperCase()} creado.` });
      setForm((f) => ({ ...f, code: '' }));
      onCreated();
    } catch (e) {
      setMessage({ tone: 'error', text: messageOf(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.create} onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Crear cupón</h2>
      <fieldset className={styles.types}>
        <legend>Tipo</legend>
        {(Object.keys(COUPON_TYPE_LABEL) as CouponType[]).map((t) => (
          <label key={t}>
            <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} />
            {COUPON_TYPE_LABEL[t]}
          </label>
        ))}
      </fieldset>

      <div className={styles.grid}>
        <div className="field">
          <label htmlFor={`${id}-code`}>Código</label>
          <input
            id={`${id}-code`}
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            required
            minLength={4}
            maxLength={20}
            pattern="[A-Za-z0-9]{4,20}"
          />
          <span className="hint">De 4 a 20 letras o números.</span>
        </div>

        {type !== 'FREE_BET' && (
          <div className="field">
            <label htmlFor={`${id}-percent`}>
              {type === 'DEPOSIT_BONUS' ? 'Porcentaje del depósito' : 'Aumento de cuota (%)'}
            </label>
            <input
              id={`${id}-percent`}
              inputMode="numeric"
              value={form.percent}
              onChange={set('percent')}
              required
            />
          </div>
        )}
        {type === 'DEPOSIT_BONUS' && (
          <div className="field">
            <label htmlFor={`${id}-maxBonus`}>Bono máximo (USD)</label>
            <input
              id={`${id}-maxBonus`}
              inputMode="decimal"
              value={form.maxBonus}
              onChange={set('maxBonus')}
              required
            />
          </div>
        )}
        {type === 'FREE_BET' && (
          <div className="field">
            <label htmlFor={`${id}-amount`}>Monto de la apuesta gratis (USD)</label>
            <input
              id={`${id}-amount`}
              inputMode="decimal"
              value={form.amount}
              onChange={set('amount')}
              required
            />
          </div>
        )}
        {type === 'ODDS_BOOST' && (
          <div className="field">
            <label htmlFor={`${id}-maxBoost`}>Aumento máximo de cuota (opcional)</label>
            <input
              id={`${id}-maxBoost`}
              inputMode="decimal"
              placeholder="0.50"
              value={form.maxBoost}
              onChange={set('maxBoost')}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor={`${id}-total`}>Canjes totales</label>
          <input
            id={`${id}-total`}
            inputMode="numeric"
            value={form.totalLimit}
            onChange={set('totalLimit')}
            required
          />
          <span className="hint">Cada persona lo canjea una sola vez.</span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-starts`}>Desde</label>
          <input
            id={`${id}-starts`}
            type="datetime-local"
            value={form.startsAt}
            onChange={set('startsAt')}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-ends`}>Hasta</label>
          <input
            id={`${id}-ends`}
            type="datetime-local"
            value={form.endsAt}
            onChange={set('endsAt')}
            required
          />
        </div>
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <button type="submit" className="button" disabled={saving}>
        {saving ? 'Creando…' : 'Crear cupón'}
      </button>
    </form>
  );
}

export default function CouponsPage() {
  return (
    <AppShell roles={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <Coupons />
    </AppShell>
  );
}
