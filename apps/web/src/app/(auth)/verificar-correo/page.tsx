'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Notice } from '@/components/Notice';
import { api, messageOf } from '@/lib/api';

type State =
  | { kind: 'checking' }
  | { kind: 'verified' }
  | { kind: 'failed'; message: string }
  | { kind: 'idle' };

function VerifyEmail() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(token ? { kind: 'checking' } : { kind: 'idle' });
  const started = useRef(false);

  useEffect(() => {
    // El token es de un solo uso: el doble render de StrictMode no debe gastarlo dos veces.
    if (!token || started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => setState({ kind: 'verified' }))
      .catch((e: unknown) => setState({ kind: 'failed', message: messageOf(e) }));
  }, [token]);

  if (state.kind === 'checking')
    return (
      <AuthShell title="Activando tu cuenta">
        <p role="status">Comprobando el enlace…</p>
      </AuthShell>
    );

  if (state.kind === 'verified')
    return (
      <AuthShell title="Cuenta activada">
        <Notice>Tu correo quedó confirmado. Ya puedes depositar y apostar.</Notice>
        <Link className="button" href="/ingresar">
          Iniciar sesión
        </Link>
      </AuthShell>
    );

  return (
    <AuthShell title="Pide un enlace nuevo">
      {state.kind === 'failed' && <Notice tone="error">{state.message}</Notice>}
      <ResendForm />
    </AuthShell>
  );
}

function ResendForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    try {
      await api('/auth/resend-verification', { method: 'POST', body: { email } });
      setSent(true);
    } catch (e) {
      setError(messageOf(e));
    }
  }

  if (sent)
    return <Notice>Si la cuenta está pendiente de activar, te enviamos un enlace nuevo.</Notice>;

  return (
    <form className="form" onSubmit={onSubmit}>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="field">
        <label htmlFor="email">Correo de tu cuenta</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <button className="button" type="submit">
        Enviar enlace de activación
      </button>
    </form>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
