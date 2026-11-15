'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MarketType, MatchStatus, type MatchSummary } from '@apuestas/shared';
import { Notice } from '@/components/Notice';
import { MatchTeams } from '@/components/MatchTeams';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../../matches.module.css';

const MARKET_LABELS: Record<MarketType, string> = {
  [MarketType.RESULT_1X2]: 'Resultado del partido',
  [MarketType.DOUBLE_CHANCE]: 'Doble oportunidad',
  [MarketType.TOTAL_GOALS]: 'Total de goles',
  [MarketType.BOTH_TEAMS_SCORE]: 'Ambos equipos marcan',
};

const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  [MatchStatus.SCHEDULED]: 'Programado',
  [MatchStatus.LIVE]: 'En vivo',
  [MatchStatus.FINISHED]: 'Finalizado',
  [MatchStatus.SUSPENDED]: 'Suspendido',
  [MatchStatus.POSTPONED]: 'Aplazado',
  [MatchStatus.CANCELLED]: 'Cancelado',
};

export default function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [match, setMatch] = useState<MatchSummary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void params
      .then(({ id }) => api<MatchSummary>(`/matches/${id}`))
      .then((result) => {
        if (active) setMatch(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    return () => {
      active = false;
    };
  }, [params]);

  return (
    <main className={styles.page}>
      <Link href="/partidos">Volver a partidos</Link>
      {error && <Notice tone="error">{error}</Notice>}
      {!match && !error && (
        <p className="muted" role="status">
          Cargando partido…
        </p>
      )}
      {match && (
        <>
          <header>
            <p className={styles.meta}>
              {match.competition?.name ?? 'Sin competición'} · {dateTime(match.kickoffAt)}
            </p>
            <h1 className={styles.visuallyHidden}>
              {match.homeTeam.name} - {match.awayTeam.name}
            </h1>
            <MatchTeams
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              homeScore={match.homeScore}
              awayScore={match.awayScore}
            />
            <p>Estado: {MATCH_STATUS_LABELS[match.status]}</p>
            <Link className="button" href={`/apuestas?matchId=${encodeURIComponent(match.id)}`}>
              Ir a Apostar
            </Link>
          </header>
          <section className={styles.grid} aria-label="Mercados publicados">
            {match.markets.map((market) => (
              <article className={styles.card} key={market.id}>
                <h2>
                  {market.type === MarketType.TOTAL_GOALS && market.line
                    ? `${MARKET_LABELS[market.type]} (${market.line})`
                    : MARKET_LABELS[market.type]}
                </h2>
                {market.selections.map((selection) => (
                  <p className={styles.selection} key={selection.id}>
                    {market.type === MarketType.TOTAL_GOALS && market.line
                      ? `${selection.label} de ${market.line}`
                      : selection.label}
                    : <strong>{Number(selection.odds).toFixed(2)}</strong>
                    <span className={styles.meta}>
                      {' '}
                      · Actualizada {dateTime(selection.updatedAt)}
                    </span>
                  </p>
                ))}
              </article>
            ))}
            {match.markets.length === 0 && (
              <p className="muted">
                Este partido no tiene cuotas disponibles para apostar. Vuelve a la cartelera y elige
                otro encuentro.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
