'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';

function NewPassword() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    setBusy(true);
    setError('');
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <AuthShell title="Contraseña cambiada">
        <Notice>Cerramos todas tus sesiones. Inicia sesión con la contraseña nueva.</Notice>
        <p>
          <Link href="/ingresar">Iniciar sesión</Link>
        </p>
      </AuthShell>
    );

  return (
    <AuthShell title="Elige una contraseña nueva">
      {!token && (
        <Notice tone="error">
          Falta el enlace de recuperación. <Link href="/recuperar">Pide uno nuevo</Link>.
        </Notice>
      )}
      <form className="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="password">Contraseña nueva</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            aria-describedby="password-hint"
          />
          <span id="password-hint" className="hint">
            Al menos 10 caracteres.
          </span>
        </div>
        <button className="button" type="submit" disabled={busy || !token}>
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </AuthShell>
  );
}

export default function NewPasswordPage() {
  return (
    <Suspense>
      <NewPassword />
    </Suspense>
  );
}
