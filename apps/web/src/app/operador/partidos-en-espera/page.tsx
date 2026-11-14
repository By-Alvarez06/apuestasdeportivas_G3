'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { splitMatchLabel } from '@/lib/bets';
import { dateTime } from '@/lib/format';
import styles from './espera.module.css';

interface Hold {
  matchId: string;
  matchLabel: string;
  status: 'SUSPENDED' | 'POSTPONED';
  deadline: string;
  resolution: 'RESUMED' | 'VOIDED' | 'CANCELLED' | null;
  resolvedAt: string | null;
  openBets: number;
}

const STATUS_LABEL: Record<Hold['status'], string> = {
  SUSPENDED: 'Suspendido',
  POSTPONED: 'Aplazado',
};

const RESOLUTION_LABEL: Record<NonNullable<Hold['resolution']>, string> = {
  RESUMED: 'Reanudado a tiempo: las apuestas siguieron vigentes',
  VOIDED: 'Venció el plazo: se anularon y reembolsaron sus apuestas',
  CANCELLED: 'Cancelado: se anularon y reembolsaron sus apuestas',
};

/** "faltan 3 h 20 min" o "vencido" (el anulado lo hace la API con su propio reloj). */
function remaining(deadline: string, now: number): string {
  const ms = Date.parse(deadline) - now;
  if (ms <= 0) return 'Plazo vencido: se anula en el próximo minuto';
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `Faltan ${hours} h ${minutes} min` : `Faltan ${minutes} min`;
}

function Holds() {
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setHolds(await api<Hold[]>('/operator/holds'));
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  useEffect(() => {
    void load();
    // El plazo restante y los vencimientos se refrescan cada minuto, como el proceso de la API.
    const timer = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const waiting = holds?.filter((h) => !h.resolution) ?? [];
  const resolved = holds?.filter((h) => h.resolution) ?? [];

  return (
    <div className={styles.page}>
      <div className="stack">
        <h1>Partidos en espera</h1>
        <p className="muted">
          Si un partido suspendido o aplazado no se reanuda antes del plazo, sus apuestas se anulan
          y se reembolsan solas. En las combinadas, esa selección cuenta con cuota 1.00.
        </p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {holds === null && !error && <p role="status">Cargando partidos…</p>}

      <section aria-label="En espera" className={styles.group}>
        <h2>En espera</h2>
        {holds && waiting.length === 0 && (
          <p className="muted">No hay partidos suspendidos ni aplazados.</p>
        )}
        <ul className={styles.list}>
          {waiting.map((h) => (
            <li key={h.matchId} className={styles.item} data-state="waiting">
              <HoldHeader hold={h} />
              <p className={styles.deadline}>
                <strong>{remaining(h.deadline, now)}</strong> — vence el {dateTime(h.deadline)}
              </p>
              <p>{h.openBets === 1 ? '1 apuesta en espera' : `${h.openBets} apuestas en espera`}</p>
            </li>
          ))}
        </ul>
      </section>

      {resolved.length > 0 && (
        <section aria-label="Resueltos en los últimos 7 días" className={styles.group}>
          <h2>Resueltos en los últimos 7 días</h2>
          <ul className={styles.list}>
            {resolved.map((h) => (
              <li key={h.matchId} className={styles.item}>
                <HoldHeader hold={h} />
                <p className="muted">
                  {RESOLUTION_LABEL[h.resolution!]}
                  {h.resolvedAt && ` (${dateTime(h.resolvedAt)})`}.
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HoldHeader({ hold }: { hold: Hold }) {
  const { competition, teams } = splitMatchLabel(hold.matchLabel);
  return (
    <div className={styles.head}>
      <h3>{teams}</h3>
      <span className={styles.status}>
        {competition && `${competition}, `}
        {STATUS_LABEL[hold.status].toLowerCase()}
      </span>
    </div>
  );
}

export default function HoldsPage() {
  return (
    <AppShell roles={[UserRole.OPERATOR, UserRole.ADMIN]}>
      <Holds />
    </AppShell>
  );
}
