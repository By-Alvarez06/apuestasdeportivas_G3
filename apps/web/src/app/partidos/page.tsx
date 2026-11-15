'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MatchStatus, type MatchSummary } from '@apuestas/shared';
import { Notice } from '@/components/Notice';
import { MatchTeams } from '@/components/MatchTeams';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../matches.module.css';

interface MatchPage {
  items: MatchSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface Competition {
  id: string;
  name: string;
  country: string | null;
}

const statuses = [
  ['', 'Todos'],
  [MatchStatus.SCHEDULED, 'Programado'],
  [MatchStatus.LIVE, 'En vivo'],
  [MatchStatus.FINISHED, 'Finalizado'],
  [MatchStatus.SUSPENDED, 'Suspendido'],
  [MatchStatus.POSTPONED, 'Aplazado'],
] as const;

function localDateStart(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function localDateEnd(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

export default function MatchesPage() {
  const [filters, setFilters] = useState({ from: '', to: '', competitionId: '', status: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchPage | null>(null);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (filters.from) query.set('from', localDateStart(filters.from));
    if (filters.to) query.set('to', localDateEnd(filters.to));
    if (filters.competitionId.trim()) query.set('competitionId', filters.competitionId.trim());
    if (filters.status) query.set('status', filters.status);
    setLoading(true);
    try {
      setError('');
      setData(await api<MatchPage>(`/matches?${query}`));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<Competition[]>('/matches/competitions')
      .then(setCompetitions)
      .catch((reason: unknown) => setError(messageOf(reason)));
  }, []);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <main className={styles.page}>
      <header>
        <h1>Partidos</h1>
        <p className="muted">
          Próximos partidos con cuotas publicadas. Se muestran hasta 20 por página; los filtros y
          horarios usan tu hora local.
        </p>
      </header>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setPage(1);
          setFilters({
            from: String(form.get('from') ?? ''),
            to: String(form.get('to') ?? ''),
            competitionId: String(form.get('competitionId') ?? ''),
            status: String(form.get('status') ?? ''),
          });
        }}
      >
        <div className="field">
          <label htmlFor="from">Desde</label>
          <input id="from" name="from" type="date" />
        </div>
        <div className="field">
          <label htmlFor="to">Hasta</label>
          <input id="to" name="to" type="date" />
        </div>
        <div className="field">
          <label htmlFor="competitionId">Competición</label>
          <select id="competitionId" name="competitionId" defaultValue="">
            <option value="">Todas</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
                {competition.country ? ` · ${competition.country}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue="">
            {statuses.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="button" type="submit">
          Filtrar
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && (
        <p className="muted" role="status">
          Cargando partidos…
        </p>
      )}
      {!loading && data?.items.length === 0 && (
        <p className="muted">No hay partidos con esos filtros.</p>
      )}

      <section className={`${styles.grid} ${styles.fixtureList}`} aria-label="Partidos">
        {data?.items.map((match) => (
          <article className={styles.card} key={match.id}>
            <p className={styles.meta}>
              {match.competition?.name ?? 'Sin competición'} · {dateTime(match.kickoffAt)}
            </p>
            <MatchTeams
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              homeScore={match.homeScore}
              awayScore={match.awayScore}
            />
            <p className={styles.meta}>Estado: {match.status}</p>
            {match.markets.length > 0 ? (
              <div className={styles.markets}>
                {match.markets.map((market) => (
                  <div className={styles.market} key={market.id}>
                    <strong>
                      {market.type === 'total_goals'
                        ? `Total de goles ${market.line}`
                        : market.type.replaceAll('_', ' ')}
                    </strong>
                    <div className={styles.selections}>
                      {market.selections.map((selection) => (
                        <span className={styles.selection} key={selection.id}>
                          {selection.label} <strong>{selection.odds}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Aún no hay mercados publicados.</p>
            )}
            <Link href={`/partidos/${match.id}`}>Ver detalle</Link>
          </article>
        ))}
      </section>

      {pages > 1 && (
        <nav className={styles.pager} aria-label="Páginas de partidos">
          <button
            className="button-quiet"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            Anteriores
          </button>
          <span className="muted">
            Página {page} de {pages}
          </span>
          <button
            className="button-quiet"
            disabled={page >= pages || loading}
            onClick={() => setPage(page + 1)}
          >
            Siguientes
          </button>
        </nav>
      )}
    </main>
  );
}
