'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  applyBoost,
  displayTotalOdds,
  ErrorCode,
  fromCents,
  oddsToString,
  parseOdds,
  potentialPayout,
  toCents,
} from '@apuestas/shared';
import { Notice } from '@/components/Notice';
import { api, ApiError, messageOf, newIdempotencyKey } from '@/lib/api';
import {
  type BettingLimits,
  type BetView,
  type Promotions,
  type SlipSelection,
  splitMatchLabel,
} from '@/lib/bets';
import { dateTime, usd } from '@/lib/format';
import styles from './BetSlip.module.css';

export interface SlipBalances {
  real: string;
  bonus: string;
}

interface Props {
  selections: SlipSelection[];
  balances: SlipBalances | null;
  limits: BettingLimits | null;
  /** Apuestas gratis y aumentos disponibles (GET /promotions). */
  promotions: Pick<Promotions, 'freeBets' | 'boosts'> | null;
  onRemove: (selectionId: string) => void;
  onClear: () => void;
  /** La API informó cuotas nuevas: el boleto se actualiza para que el apostador las revise. */
  onOddsChanged: (quotes: { selectionId: string; odds: string }[]) => void;
  onPlaced: (bet: BetView) => void;
}

/** Con qué se paga: saldo, bono o una apuesta gratis concreta (`free:<id>`). */
type Pay = 'REAL' | 'BONUS' | `free:${string}`;

const PRESETS = ['5.00', '10.00', '20.00', '50.00'];
const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/** "40.00" → 4000 (montos ya normalizados por la API o por `normalize`, incluido "0.00"). */
const centsOf = (money: string) => Number(money.replace('.', ''));

/** "10" → "10.00"; devuelve null si no es un monto válido. */
function normalize(value: string): string | null {
  const trimmed = value.trim().replace(',', '.');
  if (!MONEY.test(trimmed)) return null;
  try {
    return fromCents(toCents(trimmed));
  } catch {
    return null;
  }
}

/**
 * Boleto de apuesta. Muestra un pago estimado con el mismo cálculo que la API, pero la API decide:
 * relee las cuotas, aplica límites y promociones y descuenta el saldo al aceptar.
 */
export function BetSlip({
  selections,
  balances,
  limits,
  promotions,
  onRemove,
  onClear,
  onOddsChanged,
  onPlaced,
}: Props) {
  const headingId = useId();
  const stakeId = useId();
  const [stakeInput, setStakeInput] = useState('10.00');
  const [pay, setPay] = useState<Pay>('REAL');
  const [boostId, setBoostId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  const freeBets = promotions?.freeBets ?? [];
  const freeBet = pay.startsWith('free:')
    ? freeBets.find((f) => `free:${f.id}` === pay)
    : undefined;
  const single = selections.length === 1;
  const boost = single ? promotions?.boosts.find((b) => b.redemptionId === boostId) : undefined;

  // Si la apuesta gratis o el aumento elegidos ya no están (usados o el boleto cambió), se olvidan.
  useEffect(() => {
    if (pay.startsWith('free:') && !freeBet) setPay('REAL');
  }, [pay, freeBet]);
  useEffect(() => {
    if (boostId && !boost) setBoostId('');
  }, [boostId, boost]);

  const stake = freeBet ? freeBet.amount : normalize(stakeInput);
  const quoted = selections.map((s) => parseOdds(s.odds));
  const odds = boost
    ? quoted.map((o) =>
        applyBoost(o, boost.percent, boost.maxBoost ? toCents(boost.maxBoost) : undefined),
      )
    : quoted;
  const live = selections.some((s) => s.live);
  const source = freeBet ? 'FREE_BET' : (pay as 'REAL' | 'BONUS');

  // Una clave por intención: cambia si cambia lo que se apuesta, se conserva al reintentar lo mismo.
  const intent = JSON.stringify([
    selections.map((s) => [s.selectionId, s.odds]),
    stake,
    pay,
    boostId,
  ]);
  const keyRef = useRef({ intent, key: newIdempotencyKey() });
  if (keyRef.current.intent !== intent) keyRef.current = { intent, key: newIdempotencyKey() };

  useEffect(() => {
    setError('');
  }, [intent]);

  const gross = stake && odds.length > 0 ? potentialPayout(toCents(stake), odds) : null;
  // La apuesta gratis paga solo la ganancia, al bono.
  const estimate =
    gross === null ? null : fromCents(freeBet ? gross - toCents(freeBet.amount) : gross);

  const available =
    balances && !freeBet ? (source === 'REAL' ? balances.real : balances.bonus) : null;

  async function confirm() {
    if (!stake) {
      setError('Escribe un monto válido, por ejemplo 10.00.');
      return;
    }
    setSubmitting(true);
    setError('');
    setWarning('');
    try {
      const bet = await api<BetView>('/bets', {
        method: 'POST',
        idempotencyKey: keyRef.current.key,
        body: {
          selections: selections.map((s) => ({ selectionId: s.selectionId, odds: s.odds })),
          stake,
          source,
          ...(freeBet && { freeBetId: freeBet.id }),
          ...(boost && { boostRedemptionId: boost.redemptionId }),
        },
      });
      setBoostId('');
      setPay('REAL');
      onPlaced(bet);
    } catch (e) {
      if (e instanceof ApiError && e.code === ErrorCode.ODDS_CHANGED) {
        const quotes = (e.details?.quotes ?? []) as { selectionId: string; odds: string }[];
        const changes = quotes
          .map((q) => {
            const s = selections.find((x) => x.selectionId === q.selectionId);
            return s ? `${s.selectionLabel}: de ${s.odds} a ${q.odds}` : null;
          })
          .filter(Boolean)
          .join('; ');
        setWarning(`La cuota cambió (${changes}). Revisa el pago y confirma de nuevo.`);
        onOddsChanged(quotes);
      } else {
        setError(messageOf(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className={styles.slip} aria-labelledby={headingId}>
      <header className={styles.head}>
        <h2 id={headingId}>Tu boleto</h2>
        {selections.length > 1 && (
          <span className={styles.kind}>Combinada de {selections.length}</span>
        )}
      </header>

      {selections.length === 0 ? (
        <p className={styles.empty}>
          Toca una cuota para añadirla a tu boleto. Con cuotas de varios partidos armas una
          combinada.
        </p>
      ) : (
        <div className={styles.body}>
          <ul className={styles.picks}>
            {selections.map((s, i) => {
              const { teams } = splitMatchLabel(s.matchLabel);
              const boosted = odds[i] !== quoted[i];
              return (
                <li key={s.selectionId} className={styles.pick}>
                  <div>
                    <p className={styles.pickName}>{s.selectionLabel}</p>
                    <p className={styles.pickMeta}>
                      {s.marketLabel} — {teams}
                      {s.live && <span className={styles.live}> En vivo</span>}
                    </p>
                  </div>
                  <span className={styles.pickOdds}>
                    {boosted && <s className={styles.oldOdds}>{s.odds}</s>}
                    {oddsToString(odds[i]!)}
                  </span>
                  <button
                    type="button"
                    className={styles.remove}
                    onClick={() => onRemove(s.selectionId)}
                    aria-label={`Quitar ${s.selectionLabel} del boleto`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Junto a la selección: el cambio de cuota es lo primero que hay que ver. */}
          {warning && <Notice tone="warning">{warning}</Notice>}

          {selections.length > 1 && (
            <div className={styles.total}>
              <span>
                Cuota total <strong>{oddsToString(displayTotalOdds(odds))}</strong>
              </span>
              <button type="button" className="button-quiet" onClick={onClear}>
                Vaciar boleto
              </button>
            </div>
          )}

          {single && (promotions?.boosts.length ?? 0) > 0 && (
            <fieldset className={styles.sources}>
              <legend>Aumento de cuota</legend>
              <label className={styles.source}>
                <input type="radio" name="boost" checked={!boost} onChange={() => setBoostId('')} />
                <span>Sin aumento</span>
              </label>
              {promotions!.boosts.map((b) => (
                <label key={b.redemptionId} className={styles.source}>
                  <input
                    type="radio"
                    name="boost"
                    checked={boost?.redemptionId === b.redemptionId}
                    onChange={() => setBoostId(b.redemptionId)}
                  />
                  <span>
                    +{b.percent} %{b.maxBoost && ` (hasta +${b.maxBoost})`}
                  </span>
                  <span className={styles.sourceAmount}>{b.code}</span>
                </label>
              ))}
            </fieldset>
          )}

          {freeBet ? (
            <p className={styles.fixedStake}>
              Apuesta gratis de <strong>{usd(freeBet.amount)}</strong>: no se descuenta de tu saldo.
            </p>
          ) : (
            <div className="field">
              <label htmlFor={stakeId}>Monto</label>
              <div className={styles.stakeRow}>
                <span aria-hidden="true" className={styles.currency}>
                  $
                </span>
                <input
                  id={stakeId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                  onBlur={() => stake && setStakeInput(stake)}
                  aria-invalid={stake ? undefined : true}
                  aria-describedby={`${stakeId}-hint`}
                />
              </div>
              <span id={`${stakeId}-hint`} className="hint">
                {limits
                  ? `Entre ${usd(limits.minStake)} y ${usd(limits.maxStake)} por apuesta.`
                  : 'Monto en USD.'}
              </span>
              <div className={styles.presets} role="group" aria-label="Montos rápidos">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={styles.preset}
                    aria-pressed={stake === p}
                    onClick={() => setStakeInput(p)}
                  >
                    {usd(p).replace('.00', '')}
                  </button>
                ))}
              </div>
            </div>
          )}

          <fieldset className={styles.sources}>
            <legend>Pagar con</legend>
            {(['REAL', 'BONUS'] as const).map((value) => (
              <label key={value} className={styles.source}>
                <input
                  type="radio"
                  name="source"
                  value={value}
                  checked={pay === value}
                  onChange={() => setPay(value)}
                />
                <span>{value === 'REAL' ? 'Saldo' : 'Bono'}</span>
                <span className={styles.sourceAmount}>
                  {balances ? usd(value === 'REAL' ? balances.real : balances.bonus) : '—'}
                </span>
              </label>
            ))}
            {freeBets.map((f) => (
              <label key={f.id} className={styles.source}>
                <input
                  type="radio"
                  name="source"
                  checked={pay === `free:${f.id}`}
                  onChange={() => setPay(`free:${f.id}`)}
                />
                <span>Apuesta gratis {usd(f.amount)}</span>
                <span className={styles.sourceAmount}>vence {dateTime(f.expiresAt)}</span>
              </label>
            ))}
          </fieldset>

          <div className={styles.payout} aria-live="polite">
            <span>{freeBet ? 'Si gana, recibes en tu bono' : 'Si gana, cobras'}</span>
            <strong>{estimate ? usd(estimate) : '—'}</strong>
          </div>

          {live && (
            <p className={styles.note}>
              Apuesta en vivo: la confirmamos unos segundos después de que la envíes, con la cuota
              que siga vigente.
            </p>
          )}
          {available && stake && centsOf(stake) > centsOf(available) && (
            <Notice tone="warning">
              No tienes saldo suficiente en {source === 'REAL' ? 'tu saldo' : 'tu bono'} para este
              monto.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          <button
            type="button"
            className={`button ${styles.confirm}`}
            disabled={submitting || !stake}
            onClick={confirm}
          >
            {submitting
              ? live
                ? 'Confirmando apuesta en vivo…'
                : 'Confirmando…'
              : freeBet
                ? `Confirmar apuesta gratis de ${usd(freeBet.amount)}`
                : `Confirmar apuesta de ${stake ? usd(stake) : '—'}`}
          </button>
        </div>
      )}
    </aside>
  );
}
