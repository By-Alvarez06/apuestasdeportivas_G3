'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MatchStatus, UserRole, type MatchSummary } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { BetSlip, type SlipBalances } from '@/components/BetSlip';
import { useLive } from '@/components/LiveProvider';
import { MatchTeams } from '@/components/MatchTeams';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import {
  type BettingLimits,
  type BetView,
  type CatalogMatch,
  type Promotions,
  type SlipSelection,
  splitMatchLabel,
} from '@/lib/bets';
import { usd } from '@/lib/format';
import styles from './apuestas.module.css';

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

const MATCH_STATUS_LABELS: Record<CatalogMatch['status'], string> = {
  SCHEDULED: 'Programado',
  LIVE: 'En vivo',
  FINISHED: 'Finalizado',
  SUSPENDED: 'Suspendido',
  POSTPONED: 'Aplazado',
  CANCELLED: 'Cancelado',
};

const FIXTURE_STATUS_LABELS: Record<MatchStatus, string> = {
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
  const [promotions, setPromotions] = useState<Promotions | null>(null);
  const [slip, setSlip] = useState<SlipSelection[]>([]);
  const [placed, setPlaced] = useState<BetView | null>(null);
  const [slipNote, setSlipNote] = useState('');
  const [error, setError] = useState('');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [fixtureFilters, setFixtureFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draftFixtureFilters, setDraftFixtureFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [fixturePage, setFixturePage] = useState(1);
  const [fixtureData, setFixtureData] = useState<MatchPage | null>(null);
  const [availableFilters, setAvailableFilters] = useState<{
    key: string;
    value: MatchFilters;
  } | null>(null);
  const [fixtureError, setFixtureError] = useState('');
  const [fixturesLoading, setFixturesLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, b, l, p] = await Promise.all([
        api<CatalogMatch[]>('/catalog/matches'),
        api<SlipBalances>('/wallet'),
        api<BettingLimits>('/betting/limits'),
        api<Promotions>('/promotions'),
      ]);
      setMatches(m);
      setBalances(b);
      setLimits(l);
      setPromotions(p);
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setSelectedMatchId(new URLSearchParams(window.location.search).get('matchId'));
  }, []);
  useEffect(() => {
    const syncSelectedMatch = () =>
      setSelectedMatchId(new URLSearchParams(window.location.search).get('matchId'));
    window.addEventListener('popstate', syncSelectedMatch);
    return () => window.removeEventListener('popstate', syncSelectedMatch);
  }, []);

  const loadFixtures = useCallback(async () => {
    const query = new URLSearchParams({ page: String(fixturePage), pageSize: '20' });
    const filterQuery = new URLSearchParams();
    if (fixtureFilters.from) query.set('from', localDateStart(fixtureFilters.from));
    if (fixtureFilters.to) query.set('to', localDateEnd(fixtureFilters.to));
    if (fixtureFilters.competitionId) query.set('competitionId', fixtureFilters.competitionId);
    if (fixtureFilters.status) query.set('status', fixtureFilters.status);
    if (fixtureFilters.from) filterQuery.set('from', localDateStart(fixtureFilters.from));
    if (fixtureFilters.to) filterQuery.set('to', localDateEnd(fixtureFilters.to));
    if (fixtureFilters.competitionId)
      filterQuery.set('competitionId', fixtureFilters.competitionId);
    if (fixtureFilters.status) filterQuery.set('status', fixtureFilters.status);

    setFixturesLoading(true);
    try {
      setFixtureError('');
      const [matchesPage, options] = await Promise.all([
        api<MatchPage>(`/matches?${query}`),
        api<MatchFilters>(`/matches/filters?${filterQuery}`),
      ]);
      setFixtureData(matchesPage);
      setAvailableFilters({ key: JSON.stringify(fixtureFilters), value: options });
    } catch (reason) {
      setFixtureError(messageOf(reason));
    } finally {
      setFixturesLoading(false);
    }
  }, [fixtureFilters, fixturePage]);

  useEffect(() => {
    void loadFixtures();
  }, [loadFixtures]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void load();
      void loadFixtures();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [load, loadFixtures]);

  useEffect(() => {
    if (!availableFilters || availableFilters.key !== JSON.stringify(fixtureFilters)) return;
    const next = { ...fixtureFilters };
    if (
      next.competitionId &&
      !availableFilters.value.competitions.some(({ id }) => id === next.competitionId)
    )
      next.competitionId = '';
    if (next.status && !availableFilters.value.statuses.some(({ value }) => value === next.status))
      next.status = '';
    if (
      next.competitionId !== fixtureFilters.competitionId ||
      next.status !== fixtureFilters.status
    ) {
      setFixtureFilters(next);
      setDraftFixtureFilters(next);
      setFixturePage(1);
    }
  }, [availableFilters, fixtureFilters]);

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

  const visibleMatches = useMemo(
    () => matches?.filter((match) => match.matchId === selectedMatchId) ?? [],
    [matches, selectedMatchId],
  );
  const selectedFixture = fixtureData?.items.find((match) => match.id === selectedMatchId) ?? null;
  const selectedMatchUnavailable =
    selectedMatchId !== null && matches !== null && visibleMatches.length === 0;
  const fixturePages = fixtureData
    ? Math.max(1, Math.ceil(fixtureData.total / fixtureData.pageSize))
    : 1;

  return (
    <div className={styles.layout}>
      <div className={styles.board}>
        <header className={styles.title}>
          <h1>{selectedMatchId ? 'Apostar en este partido' : 'Partidos y apuestas'}</h1>
          {selectedMatchId && (
            <Link href="/apuestas" onClick={() => setSelectedMatchId(null)}>
              Ver todos los partidos
            </Link>
          )}
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
        {fixturesLoading && !fixtureData && (
          <p role="status" className="muted">
            Cargando cartelera…
          </p>
        )}
        {selectedMatchUnavailable && (
          <Notice tone="warning">
            Este partido no tiene cuotas abiertas para apostar ahora.{' '}
            <Link href="/apuestas" onClick={() => setSelectedMatchId(null)}>
              Ver otros partidos
            </Link>
          </Notice>
        )}

        {selectedMatchId && visibleMatches.length > 0 && (
          <MatchGroup
            title="Partido seleccionado: escudos y cuotas"
            matches={visibleMatches}
            slip={slip}
            onToggle={toggle}
            selected
          />
        )}
        {selectedMatchId && selectedMatchUnavailable && selectedFixture && (
          <SelectedFixtureOverview match={selectedFixture} />
        )}
        <MatchBrowser
          data={fixtureData}
          filters={draftFixtureFilters}
          availableFilters={availableFilters?.value ?? null}
          loading={fixturesLoading}
          error={fixtureError}
          page={fixturePage}
          pages={fixturePages}
          selectedMatchId={selectedMatchId}
          onFiltersChange={setDraftFixtureFilters}
          onFilterSubmit={(next) => {
            setDraftFixtureFilters(next);
            setFixtureFilters(next);
            setFixturePage(1);
          }}
          onPageChange={setFixturePage}
          onSelectMatch={setSelectedMatchId}
        />
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
          promotions={promotions}
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

function SelectedFixtureOverview({ match }: { match: MatchSummary }) {
  return (
    <article className={`${styles.match} ${styles.selectedMatch}`}>
      <header className={styles.matchHead}>
        <MatchTeams
          homeTeam={match.homeTeam}
          awayTeam={match.awayTeam}
          homeScore={match.homeScore}
          awayScore={match.awayScore}
        />
        <p className={styles.matchMeta}>
          <span>{match.competition?.name ?? 'Sin competición'}</span>
          <span className={match.status === MatchStatus.LIVE ? styles.liveTag : undefined}>
            {FIXTURE_STATUS_LABELS[match.status]}
          </span>
          <time dateTime={match.kickoffAt}>{kickoff(match.kickoffAt)}</time>
        </p>
      </header>
      <p className="muted">El marcador y el estado se actualizan automáticamente.</p>
    </article>
  );
}

function MatchBrowser({
  data,
  filters,
  availableFilters,
  loading,
  error,
  page,
  pages,
  selectedMatchId,
  onFiltersChange,
  onFilterSubmit,
  onPageChange,
  onSelectMatch,
}: {
  data: MatchPage | null;
  filters: FilterState;
  availableFilters: MatchFilters | null;
  loading: boolean;
  error: string;
  page: number;
  pages: number;
  selectedMatchId: string | null;
  onFiltersChange: (filters: FilterState) => void;
  onFilterSubmit: (filters: FilterState) => void;
  onPageChange: (page: number) => void;
  onSelectMatch: (matchId: string) => void;
}) {
  const liveMatches = data?.items.filter((match) => match.status === MatchStatus.LIVE) ?? [];
  const scheduledMatches =
    data?.items.filter((match) => match.status === MatchStatus.SCHEDULED) ?? [];
  const statusCount = (status: MatchStatus) =>
    availableFilters?.statuses.find((option) => option.value === status)?.count ?? 0;
  const liveLabel = `En vivo (${statusCount(MatchStatus.LIVE)})`;
  const scheduledLabel = `Próximos (${statusCount(MatchStatus.SCHEDULED)})`;
  const noMatchesMessage =
    filters.status === MatchStatus.LIVE
      ? 'No hay partidos en vivo con estos filtros en este momento.'
      : filters.status === MatchStatus.SCHEDULED
        ? 'No hay próximos partidos con estos filtros.'
        : 'No hay partidos con esos filtros.';

  return (
    <section className={styles.browser} aria-label="Buscar partidos para apostar">
      <header className={styles.browserHeader}>
        <div>
          <h2>{selectedMatchId ? 'Buscar otro partido' : 'Elige un partido para apostar'}</h2>
          <p className="muted">Filtra la cartelera y abre sus cuotas aquí mismo.</p>
        </div>
      </header>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onFilterSubmit({
            from: String(form.get('from') ?? ''),
            to: String(form.get('to') ?? ''),
            competitionId: String(form.get('competitionId') ?? ''),
            status: String(form.get('status') ?? ''),
          });
        }}
      >
        <div className="field">
          <label htmlFor="fixture-from">Desde</label>
          <input
            id="fixture-from"
            name="from"
            type="date"
            value={filters.from}
            onChange={(event) => onFiltersChange({ ...filters, from: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="fixture-to">Hasta</label>
          <input
            id="fixture-to"
            name="to"
            type="date"
            value={filters.to}
            onChange={(event) => onFiltersChange({ ...filters, to: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="fixture-competition">Competición</label>
          <select
            id="fixture-competition"
            name="competitionId"
            value={filters.competitionId}
            onChange={(event) => onFiltersChange({ ...filters, competitionId: event.target.value })}
          >
            <option value="">Todas</option>
            {availableFilters?.competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
                {competition.country ? ` · ${competition.country}` : ''}
                {` (${competition.count})`}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fixture-status">Estado</label>
          <select
            id="fixture-status"
            name="status"
            value={filters.status}
            onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}
          >
            <option value="">Todos</option>
            <option value={MatchStatus.LIVE}>{liveLabel}</option>
            <option value={MatchStatus.SCHEDULED}>{scheduledLabel}</option>
          </select>
        </div>
        <button className="button" type="submit" disabled={loading}>
          Filtrar
        </button>
      </form>

      <nav className={styles.matchTabs} aria-label="Filtrar por estado del partido">
        <button
          type="button"
          className={`${styles.matchTab} ${filters.status === '' ? styles.matchTabActive : ''}`}
          aria-pressed={filters.status === ''}
          onClick={() => onFilterSubmit({ ...filters, status: '' })}
        >
          Todos ({statusCount(MatchStatus.LIVE) + statusCount(MatchStatus.SCHEDULED)})
        </button>
        <button
          type="button"
          className={`${styles.matchTab} ${
            filters.status === MatchStatus.LIVE ? styles.matchTabActive : ''
          }`}
          aria-pressed={filters.status === MatchStatus.LIVE}
          onClick={() => onFilterSubmit({ ...filters, status: MatchStatus.LIVE })}
        >
          {liveLabel}
        </button>
        <button
          type="button"
          className={`${styles.matchTab} ${
            filters.status === MatchStatus.SCHEDULED ? styles.matchTabActive : ''
          }`}
          aria-pressed={filters.status === MatchStatus.SCHEDULED}
          onClick={() => onFilterSubmit({ ...filters, status: MatchStatus.SCHEDULED })}
        >
          {scheduledLabel}
        </button>
      </nav>

      {error && <Notice tone="error">{error}</Notice>}
      {loading && (
        <p className="muted" role="status">
          Actualizando partidos…
        </p>
      )}
      {!loading && data?.items.length === 0 && <p className="muted">{noMatchesMessage}</p>}

      {liveMatches.length > 0 && (
        <section className={styles.fixtureGroup} aria-label="Partidos en vivo">
          <h3 className={styles.liveHeading}>
            <span className={styles.liveDot} aria-hidden="true" />
            En vivo ahora
          </h3>
          <div className={styles.fixtureList}>
            {liveMatches.map((match) => (
              <FixtureCard
                key={match.id}
                match={match}
                selectedMatchId={selectedMatchId}
                onSelectMatch={onSelectMatch}
              />
            ))}
          </div>
        </section>
      )}
      {scheduledMatches.length > 0 && (
        <section className={styles.fixtureGroup} aria-label="Próximos partidos">
          <h3>Próximos partidos</h3>
          <div className={styles.fixtureList}>
            {scheduledMatches.map((match) => (
              <FixtureCard
                key={match.id}
                match={match}
                selectedMatchId={selectedMatchId}
                onSelectMatch={onSelectMatch}
              />
            ))}
          </div>
        </section>
      )}

      {pages > 1 && (
        <nav className={styles.pager} aria-label="Páginas de partidos">
          <button
            className="button-quiet"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
            type="button"
          >
            Anteriores
          </button>
          <span className="muted">
            Página {page} de {pages}
          </span>
          <button
            className="button-quiet"
            disabled={page >= pages || loading}
            onClick={() => onPageChange(page + 1)}
            type="button"
          >
            Siguientes
          </button>
        </nav>
      )}
    </section>
  );
}

function FixtureCard({
  match,
  selectedMatchId,
  onSelectMatch,
}: {
  match: MatchSummary;
  selectedMatchId: string | null;
  onSelectMatch: (matchId: string) => void;
}) {
  const selected = selectedMatchId === match.id;
  return (
    <Link
      className={`${styles.fixture} ${selected ? styles.fixtureSelected : ''}`}
      href={`/apuestas?matchId=${encodeURIComponent(match.id)}`}
      aria-current={selected ? 'page' : undefined}
      aria-label={`Ver cuotas y apostar en ${match.homeTeam.name} contra ${match.awayTeam.name}`}
      onClick={() => onSelectMatch(match.id)}
    >
      <p className={styles.fixtureMeta}>
        {match.competition?.name ?? 'Sin competición'} · {kickoff(match.kickoffAt)}
      </p>
      <MatchTeams
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeScore={match.homeScore}
        awayScore={match.awayScore}
      />
      <span className={match.status === MatchStatus.LIVE ? styles.liveStatus : styles.fixtureMeta}>
        {match.status === MatchStatus.LIVE && (
          <span className={styles.liveDot} aria-hidden="true" />
        )}
        {FIXTURE_STATUS_LABELS[match.status]}
      </span>
      <span className={styles.fixtureAction}>
        {selected ? 'Partido seleccionado' : 'Ver cuotas y apostar'}
      </span>
    </Link>
  );
}

function MatchGroup({
  title,
  matches,
  slip,
  onToggle,
  selected = false,
}: {
  title: string;
  matches: CatalogMatch[];
  slip: SlipSelection[];
  onToggle: (s: SlipSelection) => void;
  selected?: boolean;
}) {
  return (
    <section className={styles.group} aria-label={title}>
      <h2>{title}</h2>
      {matches.map((match) => {
        const { competition } = splitMatchLabel(match.label);
        const isLive = match.status === 'LIVE';
        return (
          <article
            key={match.matchId}
            className={`${styles.match} ${selected ? styles.selectedMatch : ''}`}
          >
            <header className={styles.matchHead}>
              <MatchTeams
                homeTeam={match.homeTeam}
                awayTeam={match.awayTeam}
                homeScore={match.homeScore}
                awayScore={match.awayScore}
              />
              <p className={styles.matchMeta}>
                <span>{competition ?? 'Sin competición'}</span>
                <span className={isLive ? styles.liveTag : undefined}>
                  {MATCH_STATUS_LABELS[match.status]}
                </span>
                <time dateTime={match.startsAt}>{kickoff(match.startsAt)}</time>
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
