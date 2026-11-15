'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MatchStatus, MarketType, type MatchSummary } from '@apuestas/shared';
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
  count: number;
}

interface MatchFilters {
  competitions: Competition[];
  statuses: { value: MatchStatus; label: string; count: number }[];
}

interface FilterState {
  from: string;
  to: string;
  competitionId: string;
  status: string;
}

const EMPTY_FILTERS: FilterState = { from: '', to: '', competitionId: '', status: '' };
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

function localDateStart(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}

function localDateEnd(date: string): string {
  return new Date(`${date}T23:59:59.999`).toISOString();
}

export default function MatchesPage() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchPage | null>(null);
  const [availableFilters, setAvailableFilters] = useState<{
    key: string;
    value: MatchFilters;
  } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page), pageSize: '20' });
    const filterQuery = new URLSearchParams();
    if (filters.from) query.set('from', localDateStart(filters.from));
    if (filters.to) query.set('to', localDateEnd(filters.to));
    if (filters.competitionId.trim()) query.set('competitionId', filters.competitionId.trim());
    if (filters.status) query.set('status', filters.status);
    if (filters.from) filterQuery.set('from', localDateStart(filters.from));
    if (filters.to) filterQuery.set('to', localDateEnd(filters.to));
    if (filters.competitionId.trim())
      filterQuery.set('competitionId', filters.competitionId.trim());
    if (filters.status) filterQuery.set('status', filters.status);
    setLoading(true);
    try {
      setError('');
      const [matches, options] = await Promise.all([
        api<MatchPage>(`/matches?${query}`),
        api<MatchFilters>(`/matches/filters?${filterQuery}`),
      ]);
      setData(matches);
      setAvailableFilters({ key: JSON.stringify(filters), value: options });
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
    if (!availableFilters || availableFilters.key !== JSON.stringify(filters)) return;
    const next = { ...filters };
    if (
      next.competitionId &&
      !availableFilters.value.competitions.some(({ id }) => id === next.competitionId)
    )
      next.competitionId = '';
    if (next.status && !availableFilters.value.statuses.some(({ value }) => value === next.status))
      next.status = '';
    if (next.competitionId !== filters.competitionId || next.status !== filters.status) {
      setFilters(next);
      setDraftFilters(next);
      setPage(1);
    }
  }, [availableFilters, filters]);

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
          const next = {
            from: String(form.get('from') ?? ''),
            to: String(form.get('to') ?? ''),
            competitionId: String(form.get('competitionId') ?? ''),
            status: String(form.get('status') ?? ''),
          };
          setDraftFilters(next);
          setFilters(next);
        }}
      >
        <div className="field">
          <label htmlFor="from">Desde</label>
          <input
            id="from"
            name="from"
            type="date"
            value={draftFilters.from}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, from: event.target.value }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="to">Hasta</label>
          <input
            id="to"
            name="to"
            type="date"
            value={draftFilters.to}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, to: event.target.value }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="competitionId">Competición</label>
          <select
            id="competitionId"
            name="competitionId"
            value={draftFilters.competitionId}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, competitionId: event.target.value }))
            }
          >
            <option value="">Todas</option>
            {availableFilters?.value.competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
                {competition.country ? ` · ${competition.country}` : ''}
                {` (${competition.count})`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select
            id="status"
            name="status"
            value={draftFilters.status}
            onChange={(event) =>
              setDraftFilters((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="">Todos</option>
            {availableFilters?.value.statuses.map(({ value, label, count }) => (
              <option key={value} value={value}>
                {label} ({count})
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
            <p className={styles.meta}>Estado: {MATCH_STATUS_LABELS[match.status]}</p>
            {match.markets.length > 0 ? (
              <div className={styles.markets}>
                {match.markets.map((market) => (
                  <div className={styles.market} key={market.id}>
                    <strong>
                      {market.type === MarketType.TOTAL_GOALS && market.line
                        ? `${MARKET_LABELS[market.type]} (${market.line})`
                        : MARKET_LABELS[market.type]}
                    </strong>
                    <div className={styles.selections}>
                      {market.selections.map((selection) => (
                        <span className={styles.selection} key={selection.id}>
                          {market.type === MarketType.TOTAL_GOALS && market.line
                            ? `${selection.label} de ${market.line}`
                            : selection.label}{' '}
                          <strong>{Number(selection.odds).toFixed(2)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Aún no hay mercados publicados.</p>
            )}
            <div className={styles.links}>
              <Link href={`/partidos/${match.id}`}>Ver detalle</Link>
              <Link href={`/apuestas?matchId=${encodeURIComponent(match.id)}`}>Apostar</Link>
            </div>
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
