'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { useLive } from '@/components/LiveProvider';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import {
  BET_STATUS_LABEL,
  type BettingLimits,
  type BetsPage,
  type BetView,
  SELECTION_STATUS_LABEL,
  splitMatchLabel,
} from '@/lib/bets';
import { dateTime, usd } from '@/lib/format';
import styles from './mis-apuestas.module.css';

const PAGE_SIZE = 10;

const FILTERS = [
  { value: 'OPEN', label: 'En juego' },
  { value: 'SETTLED', label: 'Liquidadas' },
  { value: '', label: 'Todas' },
] as const;

const SOURCE_LABEL: Record<BetView['source'], string> = {
  REAL: 'Saldo',
  BONUS: 'Bono',
  FREE_BET: 'Apuesta gratis',
};

/** "Tu apuesta a Barcelona SC ganó: cobraste $21.00." */
function resultText(bet: BetView): string {
  const what =
    bet.type === 'COMBO'
      ? `Tu combinada de ${bet.selections.length}`
      : `Tu apuesta a ${bet.selections[0]?.selectionLabel ?? ''}`;
  switch (bet.status) {
    case 'WON':
      return `${what} ganó: cobraste ${usd(bet.payout)}.`;
    case 'LOST':
      return `${what} perdió.`;
    case 'VOID':
      return `${what} se anuló: te devolvimos ${usd(bet.payout)}.`;
    default:
      return '';
  }
}

function MyBets() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['value']>('OPEN');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BetsPage | null>(null);
  const [error, setError] = useState('');
  const [debt, setDebt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (filter) query.set('status', filter);
      const [bets, limits] = await Promise.all([
        api<BetsPage>(`/bets?${query}`),
        api<BettingLimits>('/betting/limits'),
      ]);
      setData(bets);
      setDebt(limits.openDebt === '0.00' ? null : limits.openDebt);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [filter, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // En vivo: la apuesta cambia en su lugar (aunque el filtro sea "En juego", para que se vea qué
  // pasó) y el resultado se anuncia. Al reconectar se recarga lo que pudo perderse.
  const [announcement, setAnnouncement] = useState('');
  useLive('bet.updated', ({ bet }) => {
    setData((d) => d && { ...d, items: d.items.map((b) => (b.id === bet.id ? bet : b)) });
    if (bet.status !== 'OPEN') setAnnouncement(resultText(bet));
  });
  useLive('resync', () => void load());

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={styles.page}>
      <h1>Mis apuestas</h1>

      {debt && (
        <Notice tone="warning">
          Se corrigió el resultado de un partido y debes {usd(debt)}. Lo descontamos de tu próximo
          depósito o premio; hasta entonces no puedes apostar ni retirar.
        </Notice>
      )}

      <div className={styles.filters} role="group" aria-label="Filtrar apuestas">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={styles.filter}
            aria-pressed={filter === f.value}
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {/* La región existe desde el inicio para que el lector de pantalla anuncie cada resultado. */}
      <div aria-live="polite" aria-atomic="true">
        {announcement && <p className="notice">{announcement}</p>}
      </div>
      {data === null && !error && <p role="status">Cargando tus apuestas…</p>}
      {data?.items.length === 0 && (
        <p className="muted">
          {filter === 'OPEN'
            ? 'No tienes apuestas en juego. '
            : 'Todavía no tienes apuestas aquí. '}
          <Link href="/apuestas">Ir a apostar</Link>
        </p>
      )}

      <ul className={styles.list}>
        {data?.items.map((bet) => (
          <li key={bet.id}>
            <BetCard bet={bet} />
          </li>
        ))}
      </ul>

      {data && pages > 1 && (
        <nav className={styles.pager} aria-label="Páginas">
          <button
            type="button"
            className="button-quiet"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anteriores
          </button>
          <span>
            Página {page} de {pages}
          </span>
          <button
            type="button"
            className="button-quiet"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguientes
          </button>
        </nav>
      )}
    </div>
  );
}

function BetCard({ bet }: { bet: BetView }) {
  const settled = bet.status !== 'OPEN';
  return (
    <article className={styles.card} data-status={bet.status}>
      <header className={styles.cardHead}>
        <span className={styles.status}>{BET_STATUS_LABEL[bet.status]}</span>
        <span className="muted">
          {bet.type === 'COMBO' ? `Combinada de ${bet.selections.length}` : 'Simple'}
          {bet.live ? ', en vivo' : ''}
        </span>
      </header>

      <ul className={styles.selections}>
        {bet.selections.map((s) => {
          const { teams } = splitMatchLabel(s.matchLabel);
          return (
            <li key={s.id} className={styles.selection}>
              <div>
                <p className={styles.selectionName}>{s.selectionLabel}</p>
                <p className="muted">
                  {s.marketLabel} — {teams}
                </p>
                {s.hold && (
                  <p className={styles.hold}>
                    Partido {s.hold.status === 'SUSPENDED' ? 'suspendido' : 'aplazado'}: si no se
                    juega antes del {dateTime(s.hold.deadline)}, esta selección se anula
                    {bet.type === 'COMBO'
                      ? ' y cuenta con cuota 1.00'
                      : ' y te devolvemos el monto'}
                    .
                  </p>
                )}
              </div>
              <div className={styles.selectionSide}>
                <span className={styles.odds}>{s.odds}</span>
                {bet.type === 'COMBO' && (
                  <span className={styles.selectionStatus} data-status={s.status}>
                    {SELECTION_STATUS_LABEL[s.status]}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className={styles.figures}>
        <div>
          <dt>Apostado</dt>
          <dd>
            {usd(bet.stake)} <span className="muted">({SOURCE_LABEL[bet.source]})</span>
          </dd>
        </div>
        <div>
          <dt>Cuota</dt>
          <dd>{bet.totalOdds}</dd>
        </div>
        <div className={styles.result}>
          <dt>{settled ? (bet.status === 'LOST' ? 'Resultado' : 'Cobrado') : 'Si gana cobras'}</dt>
          <dd>
            {settled
              ? bet.status === 'LOST'
                ? 'Sin premio'
                : usd(bet.payout)
              : usd(bet.potentialPayout)}
          </dd>
        </div>
      </dl>

      <p className={styles.date}>
        Aceptada el {dateTime(bet.acceptedAt)}
        {bet.settledAt && `, liquidada el ${dateTime(bet.settledAt)}`}
      </p>
    </article>
  );
}

export default function MyBetsPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <MyBets />
    </AppShell>
  );
}
