'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { dateTime, usd } from '@/lib/format';
import styles from '../admin.module.css';

interface PendingWithdrawal {
  id: string;
  email: string;
  amount: string;
  destinationDocument: string;
  destinationPhone: string;
  reviewReason: string | null;
  createdAt: string;
}

function Withdrawals() {
  const [items, setItems] = useState<PendingWithdrawal[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ items: PendingWithdrawal[] }>('/admin/withdrawals?status=PENDING_APPROVAL'))
          .items,
      );
    } catch (e) {
      setNotice({ tone: 'error', text: messageOf(e) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(w: PendingWithdrawal, action: 'approve' | 'reject') {
    let body: object | undefined;
    if (action === 'reject') {
      const reason = window.prompt(`Motivo para rechazar el retiro de ${usd(w.amount)}:`)?.trim();
      if (!reason) return;
      body = { reason };
    }
    setBusyId(w.id);
    setNotice(null);
    try {
      await api(`/admin/withdrawals/${w.id}/${action}`, { method: 'POST', body });
      setNotice({
        tone: 'info',
        text:
          action === 'approve'
            ? `Retiro de ${usd(w.amount)} aprobado y pagado.`
            : `Retiro de ${usd(w.amount)} rechazado; el monto volvió al saldo de ${w.email}.`,
      });
      await load();
    } catch (e) {
      setNotice({ tone: 'error', text: messageOf(e) });
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <h1>Retiros por revisar</h1>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {items?.length === 0 ? (
        <p className="muted">No hay retiros pendientes de aprobación.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">Retiros pendientes de aprobación</caption>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Monto</th>
                <th scope="col">Titular</th>
                <th scope="col">Motivo de revisión</th>
                <th scope="col">Pedido</th>
                <th scope="col">Decisión</th>
              </tr>
            </thead>
            <tbody>
              {items?.map((w) => (
                <tr key={w.id}>
                  <td>{w.email}</td>
                  <td className={styles.num}>{usd(w.amount)}</td>
                  <td>
                    {w.destinationDocument}
                    <br />
                    {w.destinationPhone}
                  </td>
                  <td>{w.reviewReason}</td>
                  <td>{dateTime(w.createdAt)}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={styles.small}
                        disabled={busyId === w.id}
                        onClick={() => decide(w, 'approve')}
                      >
                        Aprobar y pagar
                      </button>
                      <button
                        className={styles.small}
                        data-tone="danger"
                        disabled={busyId === w.id}
                        onClick={() => decide(w, 'reject')}
                      >
                        Rechazar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function AdminWithdrawalsPage() {
  return (
    <AppShell roles={[UserRole.ADMIN]}>
      <Withdrawals />
    </AppShell>
  );
}
