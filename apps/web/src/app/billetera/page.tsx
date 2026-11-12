'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell, useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime, MOVEMENT_LABEL, POCKET_LABEL, usd } from '@/lib/format';
import styles from './billetera.module.css';

interface Balances {
  real: string;
  bonus: string;
  held: string;
}

interface Movement {
  id: string;
  type: string;
  account: 'REAL' | 'BONUS' | 'HELD';
  amount: string;
  createdAt: string;
}

interface MovementsPage {
  items: Movement[];
  page: number;
  pageSize: number;
  total: number;
}

const PAGE_SIZE = 15;

function Wallet() {
  const { me } = useSession();
  const [balances, setBalances] = useState<Balances | null>(null);
  const [movements, setMovements] = useState<MovementsPage | null>(null);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (type) query.set('type', type);
      const [b, m] = await Promise.all([
        api<Balances>('/wallet'),
        api<MovementsPage>(`/wallet/movements?${query}`),
      ]);
      setBalances(b);
      setMovements(m);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [page, type]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = movements ? Math.max(1, Math.ceil(movements.total / PAGE_SIZE)) : 1;

  return (
    <>
      <section aria-labelledby="saldo" className={styles.scoreboard}>
        <h1 id="saldo" className="visually-hidden">
          Tu billetera
        </h1>
        <div className={styles.main}>
          <span className={styles.label}>Saldo disponible</span>
          <span className={styles.big}>{balances ? usd(balances.real) : '—'}</span>
        </div>
        <dl className={styles.side}>
          <div>
            <dt>Bono</dt>
            <dd>{balances ? usd(balances.bonus) : '—'}</dd>
          </div>
          <div>
            <dt>Retenido por retiros</dt>
            <dd>{balances ? usd(balances.held) : '—'}</dd>
          </div>
        </dl>
        <div className={styles.actions}>
          <Link className="button" href="/billetera/depositar">
            Depositar
          </Link>
          <Link className={styles.secondary} href="/billetera/retirar">
            Retirar
          </Link>
        </div>
      </section>

      {me.status === 'UNVERIFIED' && (
        <Notice tone="warning">
          Confirma tu correo para depositar y retirar.{' '}
          <Link href="/verificar-correo">Pedir enlace de activación</Link>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section aria-labelledby="movimientos" className="stack">
        <div className={styles.listHead}>
          <h2 id="movimientos">Movimientos</h2>
          <div className="field">
            <label htmlFor="tipo" className="visually-hidden">
              Filtrar por tipo
            </label>
            <select
              id="tipo"
              className={styles.select}
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos los tipos</option>
              {Object.entries(MOVEMENT_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {movements && movements.items.length === 0 ? (
          <p className="muted">
            Todavía no hay movimientos.{' '}
            <Link href="/billetera/depositar">Haz tu primer depósito</Link>.
          </p>
        ) : (
          <ol className={styles.list}>
            {movements?.items.map((m) => (
              <li key={m.id} className={styles.row}>
                <span className={styles.what}>
                  {MOVEMENT_LABEL[m.type] ?? m.type}
                  <small>
                    {POCKET_LABEL[m.account]}, {dateTime(m.createdAt)}
                  </small>
                </span>
                <span className={styles.amount} data-sign={m.amount.startsWith('-') ? 'out' : 'in'}>
                  {usd(m.amount, { signed: true })}
                </span>
              </li>
            ))}
          </ol>
        )}

        {pages > 1 && (
          <nav aria-label="Páginas de movimientos" className={styles.pager}>
            <button className="button-quiet" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Más recientes
            </button>
            <span className="muted">
              Página {page} de {pages}
            </span>
            <button
              className="button-quiet"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              Más antiguos
            </button>
          </nav>
        )}
      </section>
    </>
  );
}

export default function WalletPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <Wallet />
    </AppShell>
  );
}
