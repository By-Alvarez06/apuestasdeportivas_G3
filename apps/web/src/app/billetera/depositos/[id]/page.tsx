'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DepositStatus, UserRole } from '@apuestas/shared';
import { AppShell } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import { usd } from '@/lib/format';
import styles from '../../forms.module.css';

interface DepositView {
  id: string;
  amount: string;
  status: DepositStatus;
}

const MESSAGE: Record<DepositStatus, { tone: 'info' | 'warning' | 'error'; text: string }> = {
  [DepositStatus.PENDING]: {
    tone: 'warning',
    text: 'Estamos confirmando el pago con Payphone. Esta página se actualiza sola.',
  },
  [DepositStatus.CREDITED]: { tone: 'info', text: 'Depósito acreditado. Ya está en tu saldo.' },
  [DepositStatus.FAILED]: {
    tone: 'error',
    text: 'Payphone no aprobó el pago o lo cancelaste. No se cobró nada; puedes intentarlo de nuevo.',
  },
  [DepositStatus.EXPIRED]: {
    tone: 'error',
    text: 'El pago no se completó a tiempo. No se cobró nada; puedes iniciar otro depósito.',
  },
  [DepositStatus.IN_REVIEW]: {
    tone: 'warning',
    text: 'Los datos del pago no coinciden con tu depósito. Lo revisará un administrador antes de acreditarlo.',
  },
};

const POLL_MS = 3000;
const MAX_POLLS = 40;

function DepositStatusView() {
  const { id } = useParams<{ id: string }>();
  const [deposit, setDeposit] = useState<DepositView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let polls = 0;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const d = await api<DepositView>(`/deposits/${id}`);
        setDeposit(d);
        if (d.status === DepositStatus.PENDING && ++polls < MAX_POLLS)
          timer = setTimeout(load, POLL_MS);
      } catch (e) {
        setError(messageOf(e));
      }
    };
    void load();
    return () => clearTimeout(timer);
  }, [id]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!deposit) return <p role="status">Cargando el depósito…</p>;

  const message = MESSAGE[deposit.status];
  return (
    <div className={styles.page}>
      <h1>Depósito</h1>
      <div className={styles.status}>
        <span className="muted">Monto</span>
        <span className={styles.statusAmount}>{usd(deposit.amount)}</span>
      </div>
      <Notice tone={message.tone}>{message.text}</Notice>
      <p>
        {deposit.status === DepositStatus.FAILED || deposit.status === DepositStatus.EXPIRED ? (
          <Link href="/billetera/depositar">Intentar otro depósito</Link>
        ) : (
          <Link href="/billetera">Ir a la billetera</Link>
        )}
      </p>
    </div>
  );
}

export default function DepositStatusPage() {
  return (
    <AppShell roles={[UserRole.BETTOR]}>
      <DepositStatusView />
    </AppShell>
  );
}
