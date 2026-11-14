'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { BetSlip, type SlipBalances } from '@/components/BetSlip';
import { useLive } from '@/components/LiveProvider';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import {
  type BettingLimits,
  type BetView,
  type CatalogMatch,
  type SlipSelection,
  splitMatchLabel,
} from '@/lib/bets';
import { usd } from '@/lib/format';
import styles from './apuestas.module.css';

function kickoff(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat('es-EC', { timeStyle: 'short' }).format(date);
  if (sameDay) return `Hoy, ${time}`;
  return new Intl.DateTimeFormat('es-EC', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function Betting() {
  const [matches, setMatches] = useState<CatalogMatch[] | null>(null);
  const [balances, setBalances] = useState<SlipBalances | null>(null);
  const [limits, setLimits] = useState<BettingLimits | null>(null);
  const [slip, setSlip] = useState<SlipSelection[]>([]);
  const [placed, setPlaced] = useState<BetView | null>(null);
  const [slipNote, setSlipNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, b, l] = await Promise.all([
        api<CatalogMatch[]>('/catalog/matches'),
        api<SlipBalances>('/wallet'),
        api<BettingLimits>('/betting/limits'),
      ]);
      setMatches(m);
      setBalances(b);
      setLimits(l);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useLive('wallet.updated', (w) => setBalances({ real: w.real, bonus: w.bonus }));
  useLive('resync', () => void load());

  /**
   * Tocar una cuota la agrega al boleto (combinada si hay varias) o la quita si ya estaba. Otra
   * cuota del mismo partido reemplaza a la anterior: una combinada no admite dos del mismo partido.
   */
  function toggle(selection: SlipSelection) {
    setPlaced(null);
    setSlipNote('');
    if (slip.some((s) => s.selectionId === selection.selectionId)) {
      setSlip(slip.filter((s) => s.selectionId !== selection.selectionId));
      return;
    }
    const sameMatch = slip.find((s) => s.matchId === selection.matchId);
    if (sameMatch) {
      setSlipNote(
        `Cambiamos ${sameMatch.selectionLabel} por ${selection.selectionLabel}: una combinada no admite dos selecciones del mismo partido.`,
      );
      setSlip(slip.map((s) => (s.matchId === selection.matchId ? selection : s)));
      return;
    }
    const max = limits?.comboMaxSelections ?? Infinity;
    if (slip.length >= max) {
      setSlipNote(`Una combinada admite como máximo ${max} selecciones.`);
      return;
    }
    setSlip([...slip, selection]);
  }

  function onOddsChanged(quotes: { selectionId: string; odds: string }[]) {
    setSlip((current) =>
      current.map((s) => {
        const q = quotes.find((x) => x.selectionId === s.selectionId);
        return q ? { ...s, odds: q.odds } : s;
      }),
    );
    void load();
  }

  function onPlaced(bet: BetView) {
    setPlaced(bet);
    setSlip([]);
    void load();
  }

  const live = matches?.filter((m) => m.status === 'LIVE') ?? [];
  const upcoming = matches?.filter((m) => m.status !== 'LIVE') ?? [];

  return (
    <div className={styles.layout}>
      <div className={styles.board}>
        <header className={styles.title}>
          <h1>Apostar</h1>
          {limits && (
            <p className="muted">
              Hoy llevas {usd(limits.dailyStakeUsed)} de {usd(limits.dailyStakePerUser)} apostados.
            </p>
          )}
        </header>

        {error && <Notice tone="error">{error}</Notice>}
        {matches === null && !error && <p role="status">Cargando partidos…</p>}
        {matches?.length === 0 && (
          <p className="muted">No hay partidos con apuestas abiertas en este momento.</p>
        )}

        {live.length > 0 && (
          <MatchGroup title="En vivo" matches={live} slip={slip} onToggle={toggle} />
        )}
        {upcoming.length > 0 && (
          <MatchGroup title="Próximos partidos" matches={upcoming} slip={slip} onToggle={toggle} />
        )}
      </div>

      <div className={styles.slipColumn}>
        {/* Junto al boleto, que es donde el apostador está mirando al confirmar. */}
        {placed && (
          <Notice>
            Apuesta aceptada: {usd(placed.stake)} a cuota {placed.totalOdds}. Si gana cobras{' '}
            {usd(placed.potentialPayout)}. <Link href="/mis-apuestas">Ver en Mis apuestas</Link>
          </Notice>
        )}
        {limits && limits.openDebt !== '0.00' && (
          <Notice tone="warning">
            Debes {usd(limits.openDebt)} por la corrección de un resultado. Podrás apostar cuando se
            descuente de tu próximo depósito o premio.
          </Notice>
        )}
        {slipNote && <Notice tone="warning">{slipNote}</Notice>}
        <BetSlip
          selections={slip}
          balances={balances}
          limits={limits}
          onRemove={(id) => {
            setSlipNote('');
            setSlip((current) => current.filter((s) => s.selectionId !== id));
          }}
          onClear={() => {
            setSlipNote('');
            setSlip([]);
          }}
          onOddsChanged={onOddsChanged}
          onPlaced={onPlaced}
        />
      </div>
    </div>
  );
}

function MatchGroup({
  title,
  matches,
  slip,
  onToggle,
}: {
  title: string;
  matches: CatalogMatch[];
  slip: SlipSelection[];
  onToggle: (s: SlipSelection) => void;
}) {
  return (
    <section className={styles.group} aria-label={title}>
      <h2>{title}</h2>
      {matches.map((match) => {
        const { competition, teams } = splitMatchLabel(match.label);
        const isLive = match.status === 'LIVE';
        return (
          <article key={match.matchId} className={styles.match}>
            <header className={styles.matchHead}>
              <h3>{teams}</h3>
              <p className={styles.matchMeta}>
                {competition && <span>{competition}</span>}
                {isLive ? (
                  <span className={styles.liveTag}>En juego</span>
                ) : (
                  <time dateTime={match.startsAt}>{kickoff(match.startsAt)}</time>
                )}
              </p>
            </header>
            {match.markets.map((market) => {
              // Solo orienta al usuario: la API decide con su propio reloj y sus datos.
              const started = !isLive && Date.parse(match.startsAt) <= Date.now();
              const open = market.status === 'OPEN' && (isLive ? market.live : !started);
              return (
                <div key={market.marketId} className={styles.market}>
                  <p className={styles.marketLabel}>
                    {market.label}
                    {!open && <span className="muted"> (cerrado)</span>}
                  </p>
                  <div className={styles.odds}>
                    {market.selections.map((s) => {
                      const picked = slip.some((x) => x.selectionId === s.selectionId);
                      return (
                        <button
                          key={s.selectionId}
                          type="button"
                          className={styles.odd}
                          aria-pressed={picked}
                          disabled={!open}
                          onClick={() =>
                            onToggle({
                              selectionId: s.selectionId,
                              matchId: match.matchId,
                              matchLabel: match.label,
                              marketLabel: market.label,
                              selectionLabel: s.label,
                              odds: s.odds,
                              live: isLive,
                            })
                          }
                        >
                          <span className={styles.oddLabel}>{s.label}</span>
                          <span className={styles.oddValue}>{s.odds}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}

export default function BettingPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <Betting />
    </AppShell>
  );
}
