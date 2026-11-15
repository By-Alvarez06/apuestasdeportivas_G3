'use client';

import { useCallback, useEffect, useState } from 'react';
import { MatchStatus, UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../../matches.module.css';

interface Competition {
  id: string;
  name: string;
}

interface Report {
  generatedAt: string;
  timezone: 'UTC';
  filters: { from: string; to: string; competitionId: string | null; status: string | null };
  summary: {
    matches: number;
    matchesByStatus: Record<string, number>;
    marketsByStatus: Record<string, number>;
    oddsChanges: number;
    operatorActions: number;
  };
  matches: {
    id: string;
    kickoff_at: string;
    status: string;
    home_score: number | null;
    away_score: number | null;
    home_team: string;
    away_team: string;
    competition: string | null;
    open_markets: number;
    suspended_markets: number;
    closed_markets: number;
  }[];
  oddsChanges: {
    changed_at: string;
    competition: string | null;
    match: string;
    market_type: string;
    line: string | null;
    selection: string;
    source: string;
    previous_odds: string | null;
    new_odds: string;
  }[];
  operatorActivity: {
    created_at: string;
    action: string;
    actor: string;
    match: string;
    competition: string | null;
    status: string;
  }[];
}

interface ExportFile {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

const today = new Date().toISOString().slice(0, 10);
const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function filterQuery(filters: {
  from: string;
  to: string;
  competitionId: string;
  status: string;
}): URLSearchParams {
  const query = new URLSearchParams();
  query.set('from', new Date(`${filters.from}T00:00:00Z`).toISOString());
  query.set('to', new Date(`${filters.to}T23:59:59Z`).toISOString());
  if (filters.competitionId) query.set('competitionId', filters.competitionId);
  if (filters.status) query.set('status', filters.status);
  return query;
}

function ReportsDashboard() {
  const [filters, setFilters] = useState({
    from: today,
    to: nextWeek,
    competitionId: '',
    status: '',
  });
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = filterQuery(filters);
      setError('');
      setReport(await api<Report>(`/operator/reports/dashboard?${query}`));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void api<Competition[]>('/operator/competitions')
      .then(setCompetitions)
      .catch((reason: unknown) => setError(messageOf(reason)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportReport(format: 'csv' | 'pdf') {
    setExporting(true);
    try {
      const query = filterQuery(filters);
      query.set('format', format);
      const file = await api<ExportFile>(`/operator/reports/export?${query}`);
      const bytes = Uint8Array.from(window.atob(file.contentBase64), (character) =>
        character.charCodeAt(0),
      );
      const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <header>
        <h1>Informes operativos</h1>
        <p className="muted">
          Periodos y horas en UTC. El dashboard, CSV y PDF aplican los mismos filtros y límites.
        </p>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setFilters({
            from: String(form.get('from') ?? ''),
            to: String(form.get('to') ?? ''),
            competitionId: String(form.get('competitionId') ?? ''),
            status: String(form.get('status') ?? ''),
          });
        }}
      >
        <div className="field">
          <label htmlFor="report-from">Desde (UTC)</label>
          <input id="report-from" name="from" type="date" defaultValue={filters.from} required />
        </div>
        <div className="field">
          <label htmlFor="report-to">Hasta (UTC)</label>
          <input id="report-to" name="to" type="date" defaultValue={filters.to} required />
        </div>
        <div className="field">
          <label htmlFor="report-competition">Competición</label>
          <select id="report-competition" name="competitionId" defaultValue={filters.competitionId}>
            <option value="">Todas</option>
            {competitions.map((competition) => (
              <option key={competition.id} value={competition.id}>
                {competition.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="report-status">Estado</label>
          <select id="report-status" name="status" defaultValue={filters.status}>
            <option value="">Todos</option>
            {Object.values(MatchStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <button className="button" disabled={loading} type="submit">
          Aplicar filtros
        </button>
      </form>

      <div className={styles.inline}>
        <button
          className="button"
          disabled={!report || exporting}
          onClick={() => void exportReport('csv')}
        >
          Exportar CSV
        </button>
        <button
          className="button"
          disabled={!report || exporting}
          onClick={() => void exportReport('pdf')}
        >
          Exportar PDF
        </button>
        {loading && (
          <span className="muted" role="status">
            Cargando informe…
          </span>
        )}
      </div>

      {report && (
        <>
          <section className={styles.grid} aria-label="Resumen">
            <article className={styles.card}>
              <h2>Partidos</h2>
              <p>{report.summary.matches}</p>
              <p className={styles.meta}>{JSON.stringify(report.summary.matchesByStatus)}</p>
            </article>
            <article className={styles.card}>
              <h2>Mercados</h2>
              <p className={styles.meta}>{JSON.stringify(report.summary.marketsByStatus)}</p>
            </article>
            <article className={styles.card}>
              <h2>Cambios de cuota</h2>
              <p>{report.summary.oddsChanges}</p>
            </article>
            <article className={styles.card}>
              <h2>Acciones de operador</h2>
              <p>{report.summary.operatorActions}</p>
            </article>
          </section>

          <section className={styles.section}>
            <h2>Partidos y mercados</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Inicio UTC</th>
                    <th>Competición</th>
                    <th>Partido</th>
                    <th>Estado</th>
                    <th>Marcador</th>
                    <th>Mercados abiertos/suspendidos/cerrados</th>
                  </tr>
                </thead>
                <tbody>
                  {report.matches.map((match) => (
                    <tr key={match.id}>
                      <td>{dateTime(match.kickoff_at)}</td>
                      <td>{match.competition ?? '—'}</td>
                      <td>
                        {match.home_team} - {match.away_team}
                      </td>
                      <td>{match.status}</td>
                      <td>
                        {match.home_score === null
                          ? '—'
                          : `${match.home_score}-${match.away_score}`}
                      </td>
                      <td>
                        {match.open_markets}/{match.suspended_markets}/{match.closed_markets}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <h2>Cambios recientes de cuotas</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Partido</th>
                    <th>Mercado</th>
                    <th>Selección</th>
                    <th>Fuente</th>
                    <th>Anterior</th>
                    <th>Nueva</th>
                  </tr>
                </thead>
                <tbody>
                  {report.oddsChanges.slice(0, 100).map((change, index) => (
                    <tr key={`${change.changed_at}-${change.selection}-${index}`}>
                      <td>{dateTime(change.changed_at)}</td>
                      <td>{change.match}</td>
                      <td>
                        {change.market_type} {change.line ?? ''}
                      </td>
                      <td>{change.selection}</td>
                      <td>{change.source}</td>
                      <td>{change.previous_odds ?? '—'}</td>
                      <td>{change.new_odds}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.section}>
            <h2>Actividad de operadores</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Competición</th>
                    <th>Partido</th>
                    <th>Acción</th>
                    <th>Usuario</th>
                  </tr>
                </thead>
                <tbody>
                  {report.operatorActivity.slice(0, 100).map((activity, index) => (
                    <tr key={`${activity.created_at}-${activity.action}-${index}`}>
                      <td>{dateTime(activity.created_at)}</td>
                      <td>{activity.competition ?? '—'}</td>
                      <td>{activity.match}</td>
                      <td>{activity.action}</td>
                      <td>{activity.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className={styles.meta}>Generado en UTC: {report.generatedAt}</p>
        </>
      )}
    </>
  );
}

export default function OperatorReportsPage() {
  return (
    <AppShell roles={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <ReportsDashboard />
    </AppShell>
  );
}
