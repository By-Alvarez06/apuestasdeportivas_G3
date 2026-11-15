'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime, usd } from '@/lib/format';
import adminStyles from '../admin.module.css';
import styles from './fraude.module.css';

type Rule =
  | 'MULTI_ACCOUNT'
  | 'ANOMALOUS_STAKE'
  | 'ODDS_DROP_PATTERN'
  | 'MIRROR_BETS'
  | 'WITHDRAWAL_NO_ACTIVITY'
  | 'RESETTLEMENT_DEBT';
type Status = 'OPEN' | 'DISMISSED' | 'CONFIRMED';

interface Alert {
  id: string;
  rule: Rule;
  severity: 'MEDIUM' | 'HIGH';
  status: Status;
  userIds: string[];
  evidence: Record<string, unknown>;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface AlertDetail extends Alert {
  users: { id: string; email: string; status: string; role: string; createdAt: string }[];
}

const RULE_LABEL: Record<Rule, string> = {
  MULTI_ACCOUNT: 'Cuentas múltiples',
  ANOMALOUS_STAKE: 'Monto anómalo',
  ODDS_DROP_PATTERN: 'Apuestas antes de caídas de cuota',
  MIRROR_BETS: 'Apuestas espejo entre cuentas',
  WITHDRAWAL_NO_ACTIVITY: 'Retiro sin apostar tras depositar',
  RESETTLEMENT_DEBT: 'Deuda por corrección de resultado',
};

const STATUS_LABEL: Record<Status, string> = {
  OPEN: 'Abierta',
  DISMISSED: 'Descartada',
  CONFIRMED: 'Confirmada',
};

const SIGNAL_LABEL: Record<string, string> = {
  device: 'el mismo navegador',
  payer: 'el mismo titular de pago',
  ip: 'la misma IP',
};

const cents = (value: unknown) =>
  typeof value === 'number'
    ? usd(`${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`)
    : '—';

/** Explica la evidencia en palabras: el administrador decide con esto. */
function explain(alert: Alert): string {
  const e = alert.evidence;
  switch (alert.rule) {
    case 'MULTI_ACCOUNT':
      return `${String(e.accounts)} cuentas usan ${SIGNAL_LABEL[String(e.kind)] ?? String(e.kind)}.`;
    case 'ANOMALOUS_STAKE':
      return `Apostó ${cents(e.stake)}, más de ${String(e.factor)} veces su promedio de ${cents(e.average)}.`;
    case 'ODDS_DROP_PATTERN':
      return `${String(e.bets)} apuestas seguidas de una caída de la cuota de ${String(e.dropPct)} % o más.`;
    case 'MIRROR_BETS':
      return `${String(e.bets)} apuestas a la misma selección desde cuentas relacionadas, con minutos de diferencia.`;
    case 'WITHDRAWAL_NO_ACTIVITY':
      return 'Pidió un retiro después de depositar, sin apostar en medio.';
    case 'RESETTLEMENT_DEBT':
      return `Al corregirse un resultado quedó debiendo ${cents(e.amount)}.`;
  }
}

function FraudAlerts() {
  const [status, setStatus] = useState<Status | ''>('OPEN');
  const [rule, setRule] = useState<Rule | ''>('');
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ pageSize: '50' });
      if (status) query.set('status', status);
      if (rule) query.set('rule', rule);
      const res = await api<{ items: Alert[]; total: number }>(`/admin/fraud-alerts?${query}`);
      setAlerts(res.items);
      setTotal(res.total);
      setError('');
    } catch (e) {
      setError(messageOf(e));
    }
  }, [status, rule]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={styles.page}>
      <div className="stack">
        <h1>Alertas de fraude</h1>
        <p className="muted">
          Las alertas altas bloquean el canje de cupones de las cuentas implicadas hasta que las
          resuelvas. Ninguna alerta suspende cuentas por sí sola.
        </p>
      </div>

      <div className={adminStyles.filters}>
        <div className="field">
          <label htmlFor="estado">Estado</label>
          <select
            id="estado"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status | '')}
          >
            <option value="OPEN">Abiertas</option>
            <option value="CONFIRMED">Confirmadas</option>
            <option value="DISMISSED">Descartadas</option>
            <option value="">Todas</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="regla">Tipo</label>
          <select id="regla" value={rule} onChange={(e) => setRule(e.target.value as Rule | '')}>
            <option value="">Todos</option>
            {(Object.keys(RULE_LABEL) as Rule[]).map((r) => (
              <option key={r} value={r}>
                {RULE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {alerts === null && !error && <p role="status">Cargando alertas…</p>}
      {alerts?.length === 0 && (
        <p className="muted">
          {status === 'OPEN' ? 'No hay alertas abiertas.' : 'No hay alertas con estos filtros.'}
        </p>
      )}
      {alerts && alerts.length > 0 && (
        <p className="muted">
          {total === 1 ? '1 alerta' : `${total} alertas`}
          {total > alerts.length && `, mostrando las ${alerts.length} más recientes`}
        </p>
      )}

      <ul className={styles.list}>
        {alerts?.map((a) => (
          <li key={a.id} className={styles.alert} data-severity={a.severity} data-status={a.status}>
            <div className={styles.alertHead}>
              <h2>{RULE_LABEL[a.rule]}</h2>
              <span className={styles.severity}>
                {a.severity === 'HIGH' ? 'Alta' : 'Media'}, {STATUS_LABEL[a.status].toLowerCase()}
              </span>
            </div>
            <p>{explain(a)}</p>
            <p className="muted">
              {a.userIds.length === 1 ? '1 cuenta' : `${a.userIds.length} cuentas`}, detectada el{' '}
              {dateTime(a.createdAt)}
              {a.resolvedAt && `, resuelta el ${dateTime(a.resolvedAt)}`}
            </p>
            {a.resolution && <p className={styles.resolution}>Motivo: {a.resolution}</p>}
            <button
              type="button"
              className="button-quiet"
              aria-expanded={selected === a.id}
              onClick={() => setSelected(selected === a.id ? null : a.id)}
            >
              {selected === a.id ? 'Ocultar detalle' : 'Ver cuentas y resolver'}
            </button>
            {selected === a.id && <AlertPanel id={a.id} onResolved={load} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlertPanel({ id, onResolved }: { id: string; onResolved: () => void }) {
  const fieldId = useId();
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [reason, setReason] = useState('');
  const [suspend, setSuspend] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api<AlertDetail>(`/admin/fraud-alerts/${id}`)
      .then(setDetail)
      .catch((e: unknown) => setMessage({ tone: 'error', text: messageOf(e) }));
  }, [id]);

  async function resolve(decision: 'DISMISSED' | 'CONFIRMED') {
    if (reason.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Escribe el motivo de tu decisión (al menos 3 letras).' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api(`/admin/fraud-alerts/${id}/resolve`, {
        method: 'POST',
        body: {
          decision,
          reason: reason.trim(),
          suspendUsers: decision === 'CONFIRMED' && suspend,
        },
      });
      onResolved();
    } catch (e) {
      setMessage({ tone: 'error', text: messageOf(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!detail) return message ? <Notice tone="error">{message.text}</Notice> : <p>Cargando…</p>;

  return (
    <div className={styles.panel}>
      <div className={adminStyles.tableWrap}>
        <table className={adminStyles.table}>
          <caption className="visually-hidden">Cuentas implicadas</caption>
          <thead>
            <tr>
              <th scope="col">Correo</th>
              <th scope="col">Estado</th>
              <th scope="col">Alta</th>
            </tr>
          </thead>
          <tbody>
            {detail.users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.status === 'SUSPENDED' ? 'Suspendida' : 'Activa'}</td>
                <td>{dateTime(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detail.status === 'OPEN' && (
        <div className={styles.resolve}>
          <div className="field">
            <label htmlFor={`${fieldId}-reason`}>Motivo de la decisión</label>
            <textarea
              id={`${fieldId}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <span className="hint">Queda en la alerta y en la auditoría.</span>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={suspend}
              onChange={(e) => setSuspend(e.target.checked)}
            />
            Al confirmar, suspender {detail.users.length === 1 ? 'la cuenta' : 'las cuentas'}
          </label>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          <div className={styles.actions}>
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={() => resolve('CONFIRMED')}
            >
              {suspend ? 'Confirmar fraude y suspender' : 'Confirmar fraude'}
            </button>
            <button
              type="button"
              className="button-quiet"
              disabled={saving}
              onClick={() => resolve('DISMISSED')}
            >
              Descartar alerta
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FraudPage() {
  return (
    <AppShell roles={[UserRole.ADMIN]}>
      <FraudAlerts />
    </AppShell>
  );
}
