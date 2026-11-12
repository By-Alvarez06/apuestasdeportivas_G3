'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Recupera tu contraseña">
      {sent ? (
        <Notice>
          Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva.
          Vence en 1 hora.
        </Notice>
      ) : (
        <form className="form" onSubmit={onSubmit}>
          {error && <Notice tone="error">{error}</Notice>}
          <div className="field">
            <label htmlFor="email">Correo de tu cuenta</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <button className="button" type="submit" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar enlace'}
          </button>
        </form>
      )}
      <p className="muted">
        <Link href="/ingresar">Volver a iniciar sesión</Link>
      </p>
    </AuthShell>
  );
}
