'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Notice } from '@/components/Notice';
import { Turnstile } from '@/components/Turnstile';
import { api, messageOf } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((token: string) => setCaptchaToken(token), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/auth/login', {
        method: 'POST',
        body: { email: data.get('email'), password: data.get('password'), captchaToken },
      });
      router.push('/billetera');
    } catch (e) {
      setError(messageOf(e));
      setCaptchaReset((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Inicia sesión">
      <form className="form" onSubmit={onSubmit}>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Turnstile onToken={onToken} resetKey={captchaReset} />
        <button className="button" type="submit" disabled={busy || !captchaToken}>
          {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
        </button>
      </form>
      <div className="stack muted">
        <p>
          <Link href="/recuperar">Olvidé mi contraseña</Link>
        </p>
        <p>
          ¿No tienes cuenta? <Link href="/registro">Crea una</Link>
        </p>
      </div>
    </AuthShell>
  );
}
