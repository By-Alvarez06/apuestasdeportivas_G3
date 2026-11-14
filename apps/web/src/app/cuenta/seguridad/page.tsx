'use client';

import { type FormEvent, useState } from 'react';
import { AppShell, useSession } from '@/components/AppShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';
import styles from './seguridad.module.css';

type Step =
  | { kind: 'idle' }
  | { kind: 'scan'; qrDataUrl: string; secret: string }
  | { kind: 'codes'; recoveryCodes: string[] };

function Security() {
  const { me, reload } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ otpauthUrl: string; qrDataUrl: string }>('/auth/2fa/setup', {
        method: 'POST',
      });
      const secret = new URL(res.otpauthUrl).searchParams.get('secret') ?? '';
      setStep({ kind: 'scan', qrDataUrl: res.qrDataUrl, secret });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { code },
      });
      setStep({ kind: 'codes', recoveryCodes: res.recoveryCodes });
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (step.kind === 'codes')
    return (
      <div className={styles.page}>
        <h1>Guarda tus códigos de recuperación</h1>
        <Notice tone="warning">
          Es la única vez que los verás. Cada uno sirve una sola vez si pierdes el teléfono.
        </Notice>
        <ul className={styles.codes}>
          {step.recoveryCodes.map((c) => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
        <button
          className="button"
          type="button"
          onClick={() => {
            setStep({ kind: 'idle' });
            reload();
          }}
        >
          Ya los guardé
        </button>
      </div>
    );

  return (
    <div className={styles.page}>
      <h1>Seguridad</h1>
      {error && <Notice tone="error">{error}</Notice>}
      {me.twoFactorEnabled ? (
        <Notice>
          La verificación en dos pasos está activa. Te pediremos un código de tu app cada vez que
          retires.
        </Notice>
      ) : step.kind === 'scan' ? (
        <form className="form" onSubmit={confirm}>
          <p>
            Escanea el código con una app autenticadora (Google Authenticator, Microsoft
            Authenticator, 1Password…) y escribe los 6 dígitos que muestra.
          </p>
          <img
            className={styles.qr}
            src={step.qrDataUrl}
            alt="Código QR para tu app autenticadora"
            width={200}
            height={200}
          />
          <p className="muted">
            ¿No puedes escanear? Escribe esta clave en la app:{' '}
            <code className={styles.secret}>{step.secret}</code>
          </p>
          <div className="field">
            <label htmlFor="code">Código de 6 dígitos</label>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
            />
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Comprobando…' : 'Activar verificación en dos pasos'}
          </button>
        </form>
      ) : (
        <div className="stack">
          <p>
            Agrega un código de tu teléfono además de la contraseña. Es obligatorio para retirar
            dinero.
          </p>
          <button className="button" type="button" onClick={start} disabled={busy}>
            {busy ? 'Preparando…' : 'Configurar verificación en dos pasos'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SecurityPage() {
  return (
    <AppShell>
      <Security />
    </AppShell>
  );
}
