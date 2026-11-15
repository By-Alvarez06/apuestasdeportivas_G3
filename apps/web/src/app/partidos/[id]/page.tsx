'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type MatchSummary } from '@apuestas/shared';
import { Notice } from '@/components/Notice';
import { MatchTeams } from '@/components/MatchTeams';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../../matches.module.css';

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
            <p>Estado: {match.status}</p>
          </header>
          <section className={styles.grid} aria-label="Mercados publicados">
            {match.markets.map((market) => (
              <article className={styles.card} key={market.id}>
                <h2>
                  {market.type === 'total_goals'
                    ? `Total de goles ${market.line}`
                    : market.type.replaceAll('_', ' ')}
                </h2>
                {market.selections.map((selection) => (
                  <p className={styles.selection} key={selection.id}>
                    {selection.label}: <strong>{selection.odds}</strong>
                    <span className={styles.meta}>
                      {' '}
                      ({selection.source === 'MANUAL' ? 'Operador' : 'API-Football'} ·{' '}
                      {dateTime(selection.updatedAt)})
                    </span>
                  </p>
                ))}
              </article>
            ))}
            {match.markets.length === 0 && <p className="muted">No hay mercados publicados.</p>}
          </section>
        </>
      )}
    </main>
  );
}
