'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { fromCents, UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { useLive } from '@/components/LiveProvider';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { type BonusView, COUPON_TYPE_LABEL, type Promotions } from '@/lib/bets';
import { dateTime, usd } from '@/lib/format';
import styles from './promociones.module.css';

const REDEMPTION_LABEL: Record<Promotions['redemptions'][number]['status'], string> = {
  AWAITING_DEPOSIT: 'Se activa con tu próximo depósito',
  GRANTED: 'Bono acreditado',
  AVAILABLE: 'Disponible',
  USED: 'Usado',
  EXPIRED: 'Vencido',
};

const centsOf = (money: string) => Number(money.replace('.', ''));

function PromotionsView() {
  const codeId = useId();
  const [data, setData] = useState<Promotions | null>(null);
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [result, setResult] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api<Promotions>('/promotions'));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLive('bonus.updated', () => void load());

  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setRedeeming(true);
    setResult(null);
    try {
      const res = await api<{ type: keyof typeof COUPON_TYPE_LABEL; status: string }>(
        '/coupons/redeem',
        { method: 'POST', body: { code: code.trim() } },
      );
      setResult({
        tone: 'info',
        text:
          res.type === 'DEPOSIT_BONUS'
            ? 'Código canjeado. El bono se acredita cuando se confirme tu próximo depósito.'
            : res.type === 'FREE_BET'
              ? 'Código canjeado. Tu apuesta gratis ya está disponible en el boleto.'
              : 'Código canjeado. Elige el aumento de cuota en el boleto de tu próxima apuesta simple.',
      });
      setCode('');
      await load();
    } catch (e) {
      setResult({ tone: 'error', text: messageOf(e) });
    } finally {
      setRedeeming(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1>Promociones</h1>

      <form className={styles.redeem} onSubmit={redeem}>
        <div className="field">
          <label htmlFor={codeId}>Código de promoción</label>
          <div className={styles.redeemRow}>
            <input
              id={codeId}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={20}
            />
            <button type="submit" className="button" disabled={redeeming || !code.trim()}>
              {redeeming ? 'Canjeando…' : 'Canjear código'}
            </button>
          </div>
        </div>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {data === null && !error && <p role="status">Cargando tus promociones…</p>}

      {data?.bonus && <Bonus bonus={data.bonus} />}

      {data && (data.freeBets.length > 0 || data.boosts.length > 0) && (
        <section aria-labelledby="disponibles" className={styles.group}>
          <h2 id="disponibles">Listas para usar</h2>
          <ul className={styles.list}>
            {data.freeBets.map((f) => (
              <li key={f.id} className={styles.item}>
                <span>Apuesta gratis de {usd(f.amount)}</span>
                <span className="muted">Vence el {dateTime(f.expiresAt)}</span>
              </li>
            ))}
            {data.boosts.map((b) => (
              <li key={b.redemptionId} className={styles.item}>
                <span>
                  Aumento de cuota +{b.percent} %{b.maxBoost && ` (hasta +${b.maxBoost})`}
                </span>
                <span className="muted">Vence el {dateTime(b.expiresAt)}</span>
              </li>
            ))}
          </ul>
          <Link href="/apuestas">Usarlas en una apuesta</Link>
        </section>
      )}

      {data && data.redemptions.length > 0 && (
        <section aria-labelledby="historial" className={styles.group}>
          <h2 id="historial">Códigos canjeados</h2>
          <ul className={styles.list}>
            {data.redemptions.map((r) => (
              <li key={r.id} className={styles.item}>
                <span>
                  <strong>{r.code}</strong> — {COUPON_TYPE_LABEL[r.type]}
                </span>
                <span className="muted">
                  {REDEMPTION_LABEL[r.status]}, {dateTime(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** El bono vigente con su avance de rollover: lo que falta apostar para poder retirarlo. */
function Bonus({ bonus }: { bonus: BonusView }) {
  const required = centsOf(bonus.wagerRequired);
  const progress = centsOf(bonus.wagerProgress);
  const pct = required > 0 ? Math.min(100, Math.floor((progress * 100) / required)) : 100;
  const missing = Math.max(0, required - progress);

  return (
    <section aria-labelledby="bono" className={styles.bonus} data-status={bonus.status}>
      <h2 id="bono">Tu bono de {usd(bonus.amount)}</h2>
      {bonus.status === 'ACTIVE' ? (
        <>
          <p>
            Para pasarlo a tu saldo retirable, apuesta {usd(bonus.wagerRequired)} con saldo de bono
            antes del {dateTime(bonus.expiresAt)}.
          </p>
          <div
            className={styles.bar}
            role="progressbar"
            aria-label="Avance del requisito de apuesta"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${usd(bonus.wagerProgress)} de ${usd(bonus.wagerRequired)}`}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <p className={styles.barLegend}>
            <strong>{usd(bonus.wagerProgress)}</strong> de {usd(bonus.wagerRequired)}
            {missing > 0 && `: te faltan ${usd(fromCents(missing))}`}
          </p>
          <p className="muted">
            Solo cuentan las apuestas con saldo de bono ya liquidadas y con cuota de 1.50 o más.
          </p>
        </>
      ) : (
        <p>
          {bonus.status === 'CONVERTED'
            ? 'Cumpliste el requisito: el bono pasó a tu saldo retirable.'
            : 'El bono venció sin cumplir el requisito de apuesta.'}
        </p>
      )}
    </section>
  );
}

export default function PromotionsPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <PromotionsView />
    </AppShell>
  );
}
