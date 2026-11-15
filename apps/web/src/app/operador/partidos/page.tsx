'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  MarketStatus,
  MarketType,
  MatchStatus,
  type MatchSummary,
  UserRole,
} from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../../matches.module.css';

interface Competition {
  id: string;
  name: string;
  country: string | null;
}

interface MatchPage {
  items: MatchSummary[];
  total: number;
  page: number;
  pageSize: number;
}

interface SyncStatus {
  enabled: boolean;
  disabledReason: string | null;
  budget: {
    enabled: boolean;
    limit: number;
    consumed: number;
    remaining: number;
    resetsAt: string;
    reason: string | null;
  };
  liveMatches: number;
  scheduledMatches: number;
  oddsSyncEnabled: boolean;
  oddsSyncReason: string | null;
}

const selections: Record<MarketType, { key: string; label: string }[]> = {
  [MarketType.RESULT_1X2]: [
    { key: 'HOME', label: 'Local' },
    { key: 'DRAW', label: 'Empate' },
    { key: 'AWAY', label: 'Visitante' },
  ],
  [MarketType.DOUBLE_CHANCE]: [
    { key: 'HOME_OR_DRAW', label: 'Local o empate' },
    { key: 'HOME_OR_AWAY', label: 'Local o visitante' },
    { key: 'DRAW_OR_AWAY', label: 'Empate o visitante' },
  ],
  [MarketType.TOTAL_GOALS]: [
    { key: 'OVER', label: 'Más' },
    { key: 'UNDER', label: 'Menos' },
  ],
  [MarketType.BOTH_TEAMS_SCORE]: [
    { key: 'YES', label: 'Sí' },
    { key: 'NO', label: 'No' },
  ],
};

const statusNames: Record<MatchStatus, string> = {
  [MatchStatus.SCHEDULED]: 'Programado',
  [MatchStatus.LIVE]: 'En vivo',
  [MatchStatus.FINISHED]: 'Finalizado',
  [MatchStatus.SUSPENDED]: 'Suspendido',
  [MatchStatus.POSTPONED]: 'Aplazado',
  [MatchStatus.CANCELLED]: 'Cancelado',
};

const marketNames: Record<MarketType, string> = {
  [MarketType.RESULT_1X2]: 'Resultado 1X2',
  [MarketType.DOUBLE_CHANCE]: 'Doble oportunidad',
  [MarketType.TOTAL_GOALS]: 'Total de goles',
  [MarketType.BOTH_TEAMS_SCORE]: 'Ambos equipos marcan',
};

const allStatuses = Object.values(MatchStatus);
const allMarketStatuses = Object.values(MarketStatus);

function localDateTimeValue(iso: string): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function MarketCreator({
  matchId,
  busy,
  onCreate,
}: {
  matchId: string;
  busy: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>, matchId: string, type: MarketType) => void;
}) {
  const [type, setType] = useState(MarketType.RESULT_1X2);
  return (
    <form className={styles.section} onSubmit={(event) => onCreate(event, matchId, type)}>
      <h3>Añadir mercado manual</h3>
      <div className={styles.formGrid}>
        <div className="field">
          <label htmlFor={`type-${matchId}`}>Tipo</label>
          <select
            id={`type-${matchId}`}
            name="type"
            value={type}
            onChange={(event) => setType(event.currentTarget.value as MarketType)}
          >
            {Object.values(MarketType).map((marketType) => (
              <option key={marketType} value={marketType}>
                {marketNames[marketType]}
              </option>
            ))}
          </select>
        </div>
        {type === MarketType.TOTAL_GOALS && (
          <div className="field">
            <label htmlFor={`line-${matchId}`}>Línea de goles</label>
            <input
              id={`line-${matchId}`}
              name="line"
              inputMode="decimal"
              placeholder="2.5"
              required
            />
          </div>
        )}
        {selections[type].map(({ key, label }) => (
          <div className="field" key={key}>
            <label htmlFor={`${matchId}-${key}`}>Cuota {label}</label>
            <input
              id={`${matchId}-${key}`}
              name={`odds-${key}`}
              inputMode="decimal"
              placeholder="1.850"
              required
            />
          </div>
        ))}
      </div>
      <button className="button" disabled={busy} type="submit">
        Crear mercado
      </button>
    </form>
  );
}

function OperatorMatches() {
  const { me } = useSession();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [matchPage, setMatchPage] = useState<MatchPage | null>(null);
  const [page, setPage] = useState(1);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [matchPage, competitionList, syncStatus] = await Promise.all([
        api<MatchPage>(`/operator/matches?page=${page}&pageSize=20`),
        api<Competition[]>('/operator/competitions'),
        api<SyncStatus>('/operator/sync/status'),
      ]);
      setMatchPage(matchPage);
      setMatches(matchPage.items);
      setCompetitions(competitionList);
      setSync(syncStatus);
      setError('');
    } catch (reason) {
      setError(messageOf(reason));
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
      await load();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function createCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const country = String(form.get('country') ?? '').trim();
    if (!name) return;
    void mutate(
      () =>
        api('/operator/competitions', {
          method: 'POST',
          body: { name, country: country || undefined },
        }),
      'Competición creada.',
    );
    event.currentTarget.reset();
  }

  function updateCompetition(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const country = String(form.get('country') ?? '').trim();
    void mutate(
      () =>
        api(`/operator/competitions/${id}`, {
          method: 'PATCH',
          body: { name, country },
        }),
      'Competición actualizada.',
    );
  }

  function createMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const competitionId = String(form.get('competitionId') ?? '');
    void mutate(
      () =>
        api('/operator/matches', {
          method: 'POST',
          body: {
            competitionId: competitionId || undefined,
            homeTeamName: String(form.get('homeTeamName') ?? '').trim(),
            awayTeamName: String(form.get('awayTeamName') ?? '').trim(),
            kickoffAt: new Date(String(form.get('kickoffAt'))).toISOString(),
          },
        }),
      'Partido creado.',
    );
    event.currentTarget.reset();
  }

  function updateMatch(event: FormEvent<HTMLFormElement>, matchId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const competitionId = String(form.get('competitionId') ?? '');
    void mutate(
      () =>
        api(`/operator/matches/${matchId}`, {
          method: 'PATCH',
          body: {
            competitionId: competitionId || undefined,
            homeTeamName: String(form.get('homeTeamName') ?? '').trim(),
            awayTeamName: String(form.get('awayTeamName') ?? '').trim(),
            kickoffAt: new Date(String(form.get('kickoffAt'))).toISOString(),
          },
        }),
      'Datos del partido actualizados.',
    );
  }

  function changeStatus(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const homeScore = String(form.get('homeScore') ?? '');
    const awayScore = String(form.get('awayScore') ?? '');
    void mutate(
      () =>
        api(`/operator/matches/${id}/status`, {
          method: 'PATCH',
          body: {
            status: String(form.get('status')),
            ...(homeScore !== '' && awayScore !== ''
              ? { homeScore: Number(homeScore), awayScore: Number(awayScore) }
              : {}),
            reason: String(form.get('reason') ?? '').trim() || undefined,
          },
        }),
      'Estado del partido actualizado.',
    );
  }

  function createMarket(event: FormEvent<HTMLFormElement>, matchId: string, type: MarketType) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const outcomes = selections[type];
    if (!outcomes) return;
    const line = String(form.get('line') ?? '').trim();
    const marketSelections = outcomes.map(({ key }) => ({
      key,
      odds: String(form.get(`odds-${key}`) ?? '').trim(),
    }));
    void mutate(
      () =>
        api(`/operator/matches/${matchId}/markets`, {
          method: 'POST',
          body: {
            type,
            ...(type === MarketType.TOTAL_GOALS ? { line } : {}),
            selections: marketSelections,
          },
        }),
      'Mercado creado con sus cuotas manuales.',
    );
    event.currentTarget.reset();
  }

  return (
    <>
      <header>
        <h1>Gestión de partidos y mercados</h1>
        <p className="muted">
          Los cambios manuales quedan auditados. Finalizar o cancelar partidos requiere permiso de
          administrador y un motivo.
        </p>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {success && <Notice>{success}</Notice>}

      <section className={styles.section} aria-labelledby="sync-title">
        <h2 id="sync-title">Sincronización API-Football</h2>
        {sync ? (
          <>
            <p>
              {sync.enabled ? 'Worker activo' : 'Worker desactivado'} · {sync.liveMatches} en vivo ·{' '}
              {sync.scheduledMatches} programados
            </p>
            <p>
              Presupuesto diario UTC:{' '}
              {sync.budget.enabled
                ? `${sync.budget.consumed}/${sync.budget.limit} consumidas (${sync.budget.remaining} restantes)`
                : (sync.budget.reason ?? 'No configurado')}
            </p>
            {!sync.enabled && sync.disabledReason && (
              <Notice tone="warning">{sync.disabledReason}</Notice>
            )}
            <p>
              Cuotas externas: {sync.oddsSyncEnabled ? 'activas' : 'inactivas'}
              {sync.oddsSyncReason ? ` — ${sync.oddsSyncReason}` : ''}
            </p>
            <p className={styles.meta}>
              El presupuesto se reinicia: {dateTime(sync.budget.resetsAt)}
            </p>
          </>
        ) : (
          <p className="muted">Consultando estado del worker…</p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Nueva competición</h2>
        <form className={styles.inline} onSubmit={createCompetition}>
          <div className="field">
            <label htmlFor="competition-name">Nombre</label>
            <input id="competition-name" name="name" required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="competition-country">País</label>
            <input id="competition-country" name="country" maxLength={80} />
          </div>
          <button className="button" disabled={busy} type="submit">
            Crear competición
          </button>
        </form>
        {competitions.map((competition) => (
          <form
            className={styles.inline}
            key={competition.id}
            onSubmit={(event) => updateCompetition(event, competition.id)}
          >
            <label>
              <span className="visually-hidden">Nombre de {competition.name}</span>
              <input name="name" defaultValue={competition.name} required maxLength={120} />
            </label>
            <label>
              <span className="visually-hidden">País de {competition.name}</span>
              <input name="country" defaultValue={competition.country ?? ''} maxLength={80} />
            </label>
            <button className="button-quiet" disabled={busy} type="submit">
              Guardar competición
            </button>
          </form>
        ))}
      </section>

      <section className={styles.section}>
        <h2>Nuevo partido</h2>
        <form className={styles.formGrid} onSubmit={createMatch}>
          <div className="field">
            <label htmlFor="match-competition">Competición</label>
            <select id="match-competition" name="competitionId" defaultValue="">
              <option value="">Sin competición</option>
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {competition.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="homeTeamName">Equipo local</label>
            <input id="homeTeamName" name="homeTeamName" required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="awayTeamName">Equipo visitante</label>
            <input id="awayTeamName" name="awayTeamName" required maxLength={100} />
          </div>
          <div className="field">
            <label htmlFor="kickoffAt">Inicio</label>
            <input id="kickoffAt" name="kickoffAt" type="datetime-local" required />
          </div>
          <button className="button" disabled={busy} type="submit">
            Crear partido
          </button>
        </form>
      </section>

      <section className={styles.grid} aria-label="Partidos que puede gestionar el operador">
        {matches.map((match) => (
          <article className={styles.card} key={match.id}>
            <p className={styles.meta}>
              {match.competition?.name ?? 'Sin competición'} · {dateTime(match.kickoffAt)}
            </p>
            <h2 className={styles.teams}>
              {match.homeTeam.name}{' '}
              {match.homeScore !== null && ` ${match.homeScore} - ${match.awayScore} `}
              {match.awayTeam.name}
            </h2>
            <p>Estado: {statusNames[match.status]}</p>

            <details>
              <summary>Editar datos del partido</summary>
              <form className={styles.formGrid} onSubmit={(event) => updateMatch(event, match.id)}>
                <div className="field">
                  <label htmlFor={`edit-competition-${match.id}`}>Competición</label>
                  <select
                    id={`edit-competition-${match.id}`}
                    name="competitionId"
                    defaultValue={match.competition?.id ?? ''}
                  >
                    <option value="">Sin competición</option>
                    {competitions.map((competition) => (
                      <option key={competition.id} value={competition.id}>
                        {competition.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`edit-home-${match.id}`}>Equipo local</label>
                  <input
                    id={`edit-home-${match.id}`}
                    name="homeTeamName"
                    defaultValue={match.homeTeam.name}
                    required
                    maxLength={100}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-away-${match.id}`}>Equipo visitante</label>
                  <input
                    id={`edit-away-${match.id}`}
                    name="awayTeamName"
                    defaultValue={match.awayTeam.name}
                    required
                    maxLength={100}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`edit-kickoff-${match.id}`}>Inicio (hora local)</label>
                  <input
                    id={`edit-kickoff-${match.id}`}
                    name="kickoffAt"
                    type="datetime-local"
                    defaultValue={localDateTimeValue(match.kickoffAt)}
                    required
                  />
                </div>
                <button className="button" disabled={busy} type="submit">
                  Guardar cambios
                </button>
              </form>
            </details>

            <form className={styles.formGrid} onSubmit={(event) => changeStatus(event, match.id)}>
              <div className="field">
                <label htmlFor={`status-${match.id}`}>Nuevo estado</label>
                <select id={`status-${match.id}`} name="status" defaultValue={match.status}>
                  {allStatuses
                    .filter(
                      (status) =>
                        me.role === UserRole.ADMIN ||
                        (status !== MatchStatus.FINISHED && status !== MatchStatus.CANCELLED),
                    )
                    .map((status) => (
                      <option key={status} value={status}>
                        {statusNames[status]}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`home-score-${match.id}`}>Marcador local</label>
                <input
                  id={`home-score-${match.id}`}
                  name="homeScore"
                  type="number"
                  min="0"
                  defaultValue={match.homeScore ?? ''}
                />
              </div>
              <div className="field">
                <label htmlFor={`away-score-${match.id}`}>Marcador visitante</label>
                <input
                  id={`away-score-${match.id}`}
                  name="awayScore"
                  type="number"
                  min="0"
                  defaultValue={match.awayScore ?? ''}
                />
              </div>
              <div className="field">
                <label htmlFor={`reason-${match.id}`}>
                  Motivo (requerido para finalizar/cancelar)
                </label>
                <input id={`reason-${match.id}`} name="reason" maxLength={500} />
              </div>
              <button className="button" disabled={busy} type="submit">
                Actualizar estado
              </button>
            </form>

            <MarketCreator matchId={match.id} busy={busy} onCreate={createMarket} />

            {match.markets.map((market) => (
              <section className={styles.section} key={market.id}>
                <div className={styles.inline}>
                  <h3>
                    {marketNames[market.type]}
                    {market.line ? ` (${market.line})` : ''}
                  </h3>
                  <label htmlFor={`market-status-${market.id}`}>Estado</label>
                  <select
                    id={`market-status-${market.id}`}
                    defaultValue={market.status}
                    onChange={(event) =>
                      void mutate(
                        () =>
                          api(`/operator/markets/${market.id}/status`, {
                            method: 'PATCH',
                            body: { status: event.currentTarget.value },
                          }),
                        'Estado del mercado actualizado.',
                      )
                    }
                  >
                    {allMarketStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Selección</th>
                        <th>Fuente actual</th>
                        <th>Cuota vigente</th>
                        <th>Cambiar cuota manual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {market.selections.map((selection) => (
                        <tr key={selection.id}>
                          <td>{selection.label}</td>
                          <td>{selection.source === 'MANUAL' ? 'Manual' : 'API-Football'}</td>
                          <td>{selection.odds}</td>
                          <td>
                            <form
                              className={styles.inline}
                              onSubmit={(event) => {
                                event.preventDefault();
                                const form = new FormData(event.currentTarget);
                                const odds = String(form.get('odds') ?? '').trim();
                                void mutate(
                                  () =>
                                    api(`/operator/markets/${market.id}/odds`, {
                                      method: 'PATCH',
                                      body: { key: selection.key, odds },
                                    }),
                                  'Cuota manual actualizada.',
                                );
                              }}
                            >
                              <label className="visually-hidden" htmlFor={`odds-${selection.id}`}>
                                Nueva cuota para {selection.label}
                              </label>
                              <input
                                id={`odds-${selection.id}`}
                                name="odds"
                                placeholder="1.850"
                                required
                              />
                              <button className="button-quiet" disabled={busy} type="submit">
                                Guardar
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </article>
        ))}
      </section>
      {!matches.length && <p className="muted">No hay partidos registrados todavía.</p>}
      <nav className={styles.pager} aria-label="Páginas de gestión de partidos">
        <button
          className="button-quiet"
          disabled={page <= 1 || busy}
          onClick={() => setPage((current) => current - 1)}
        >
          Anteriores
        </button>
        <span className="muted">
          Página {page} de{' '}
          {matchPage ? Math.max(1, Math.ceil(matchPage.total / matchPage.pageSize)) : 1}
        </span>
        <button
          className="button-quiet"
          disabled={!matchPage || page >= Math.ceil(matchPage.total / matchPage.pageSize) || busy}
          onClick={() => setPage((current) => current + 1)}
        >
          Siguientes
        </button>
      </nav>
    </>
  );
}

export default function OperatorMatchesPage() {
  return (
    <AppShell roles={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <OperatorMatches />
    </AppShell>
  );
}
