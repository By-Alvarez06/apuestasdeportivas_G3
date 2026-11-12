'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell, useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime } from '@/lib/format';
import styles from '../admin.module.css';

interface AdminUser {
  id: string;
  email: string;
  role: UserRole;
  status: 'UNVERIFIED' | 'ACTIVE' | 'SUSPENDED';
  twoFactorEnabled: boolean;
  createdAt: string;
}

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.BETTOR]: 'Apostador',
  [UserRole.OPERATOR]: 'Operador',
  [UserRole.ADMIN]: 'Administrador',
};

const STATUS_LABEL: Record<AdminUser['status'], string> = {
  UNVERIFIED: 'Sin verificar',
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
};

function Users() {
  const { me } = useSession();
  const [filters, setFilters] = useState({ email: '', role: '', status: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminUser[]; total: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), pageSize: '20' });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    try {
      setData(await api(`/admin/users?${q}`));
    } catch (e) {
      setNotice({ tone: 'error', text: messageOf(e) });
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(user: AdminUser, path: 'role' | 'status', body: object, done: string) {
    setBusyId(user.id);
    setNotice(null);
    try {
      await api(`/admin/users/${user.id}/${path}`, { method: 'PATCH', body });
      setNotice({ tone: 'info', text: done });
      await load();
    } catch (e) {
      setNotice({ tone: 'error', text: messageOf(e) });
    } finally {
      setBusyId('');
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;

  return (
    <>
      <h1>Usuarios</h1>
      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPage(1);
          setFilters({
            email: String(f.get('email') ?? ''),
            role: String(f.get('role') ?? ''),
            status: String(f.get('status') ?? ''),
          });
        }}
      >
        <div className="field">
          <label htmlFor="email">Correo contiene</label>
          <input id="email" name="email" type="search" />
        </div>
        <div className="field">
          <label htmlFor="role">Rol</label>
          <select id="role" name="role" defaultValue="">
            <option value="">Todos</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Estado</label>
          <select id="status" name="status" defaultValue="">
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <button className={styles.small} type="submit">
          Filtrar
        </button>
      </form>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className="visually-hidden">Usuarios registrados</caption>
          <thead>
            <tr>
              <th scope="col">Correo</th>
              <th scope="col">Rol</th>
              <th scope="col">Estado</th>
              <th scope="col">2FA</th>
              <th scope="col">Alta</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <label className="visually-hidden" htmlFor={`rol-${u.id}`}>
                    Rol de {u.email}
                  </label>
                  <select
                    id={`rol-${u.id}`}
                    className={styles.select}
                    value={u.role}
                    disabled={busyId === u.id}
                    onChange={(e) =>
                      update(u, 'role', { role: e.target.value }, `Rol de ${u.email} actualizado.`)
                    }
                  >
                    {Object.entries(ROLE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{STATUS_LABEL[u.status]}</td>
                <td>{u.twoFactorEnabled ? 'Sí' : 'No'}</td>
                <td>{dateTime(u.createdAt)}</td>
                <td>
                  {u.id !== me.id &&
                    (u.status === 'SUSPENDED' ? (
                      <button
                        className={styles.small}
                        disabled={busyId === u.id}
                        onClick={() =>
                          update(u, 'status', { status: 'ACTIVE' }, `${u.email} reactivada.`)
                        }
                      >
                        Reactivar
                      </button>
                    ) : (
                      <button
                        className={styles.small}
                        data-tone="danger"
                        disabled={busyId === u.id}
                        onClick={() =>
                          update(
                            u,
                            'status',
                            { status: 'SUSPENDED' },
                            `${u.email} suspendida; sus sesiones se cerraron.`,
                          )
                        }
                      >
                        Suspender
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.items.length === 0 && <p className="muted">Ningún usuario coincide con el filtro.</p>}

      <nav aria-label="Páginas de usuarios" className={styles.pager}>
        <button className="button-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          Anterior
        </button>
        <span className="muted">
          Página {page} de {pages}
        </span>
        <button className="button-quiet" disabled={page >= pages} onClick={() => setPage(page + 1)}>
          Siguiente
        </button>
      </nav>
    </>
  );
}

export default function UsersPage() {
  return (
    <AppShell roles={[UserRole.ADMIN]}>
      <Users />
    </AppShell>
  );
}
