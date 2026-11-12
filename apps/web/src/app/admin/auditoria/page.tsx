'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../admin.module.css';

interface AuditEntry {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string;
  userAgent: string;
  createdAt: string;
}

const PAGE_SIZE = 50;

function Audit() {
  const [filters, setFilters] = useState({ action: '', actorId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AuditEntry[]; total: number } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (filters.action) q.set('action', filters.action);
    if (filters.actorId) q.set('actorId', filters.actorId);
    if (filters.from) q.set('from', new Date(filters.from).toISOString());
    if (filters.to) q.set('to', new Date(`${filters.to}T23:59:59`).toISOString());
    try {
      setError('');
      setData(await api(`/admin/audit?${q}`));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <h1>Auditoría</h1>
      <p className="muted">
        Registro de solo lectura de las acciones sensibles. Nadie puede editar ni borrar entradas.
      </p>
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPage(1);
          setFilters({
            action: String(f.get('action') ?? '').trim(),
            actorId: String(f.get('actorId') ?? '').trim(),
            from: String(f.get('from') ?? ''),
            to: String(f.get('to') ?? ''),
          });
        }}
      >
        <div className="field">
          <label htmlFor="action">Acción</label>
          <input id="action" name="action" placeholder="auth.login.failed" />
        </div>
        <div className="field">
          <label htmlFor="actorId">Id del usuario</label>
          <input id="actorId" name="actorId" />
        </div>
        <div className="field">
          <label htmlFor="from">Desde</label>
          <input id="from" name="from" type="date" />
        </div>
        <div className="field">
          <label htmlFor="to">Hasta</label>
          <input id="to" name="to" type="date" />
        </div>
        <button className={styles.small} type="submit">
          Filtrar
        </button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="visually-hidden">Entradas de auditoría</caption>
          <thead>
            <tr>
              <th scope="col">Cuándo</th>
              <th scope="col">Acción</th>
              <th scope="col">Quién</th>
              <th scope="col">Sobre qué</th>
              <th scope="col">IP y dispositivo</th>
              <th scope="col">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((a) => (
              <tr key={a.id}>
                <td>{dateTime(a.createdAt)}</td>
                <td>{a.action}</td>
                <td className={styles.meta}>{a.actorId ?? 'anónimo'}</td>
                <td className={styles.meta}>
                  {a.targetType ? `${a.targetType} ${a.targetId ?? ''}` : ''}
                </td>
                <td className={styles.meta}>
                  {a.ip}
                  <br />
                  {a.userAgent}
                </td>
                <td className={styles.meta}>
                  {Object.keys(a.metadata).length ? JSON.stringify(a.metadata) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.items.length === 0 && <p className="muted">No hay entradas con esos filtros.</p>}

      <nav aria-label="Páginas de auditoría" className={styles.pager}>
        <button className="button-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Más recientes
        </button>
        <span className="muted">
          Página {page} de {pages}
        </span>
        <button className="button-quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Más antiguas
        </button>
      </nav>
    </>
  );
}

export default function AuditPage() {
  return (
    <AppShell roles={[UserRole.ADMIN]}>
      <Audit />
    </AppShell>
  );
}
