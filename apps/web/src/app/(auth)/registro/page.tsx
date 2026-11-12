'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Notice } from '@/components/Notice';
import { Turnstile } from '@/components/Turnstile';
import { api, messageOf } from '@/lib/api';

export default function RegisterPage() {
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((token: string) => setCaptchaToken(token), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/auth/register', {
        method: 'POST',
        body: {
          email: data.get('email'),
          password: data.get('password'),
          birthDate: data.get('birthDate'),
          captchaToken,
        },
      });
      setSentTo(String(data.get('email')));
    } catch (e) {
      setError(messageOf(e));
      setCaptchaReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="Revisa tu correo">
        <Notice>
          Te enviamos un enlace a <strong>{sentTo}</strong> para activar tu cuenta. Vence en 24
          horas.
        </Notice>
        <p className="muted">
          ¿No llegó? Revisa la carpeta de spam o{' '}
          <Link href="/verificar-correo">pide otro enlace</Link>.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Crea tu cuenta">
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
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
            aria-describedby="password-hint"
          />
          <span id="password-hint" className="hint">
            Al menos 10 caracteres. Rechazamos contraseñas que aparecen en filtraciones conocidas.
          </span>
        </div>
        <div className="field">
          <label htmlFor="birthDate">Fecha de nacimiento</label>
          <input
            id="birthDate"
            name="birthDate"
            type="date"
            required
            aria-describedby="birth-hint"
          />
          <span id="birth-hint" className="hint">
            Necesitas tener 18 años o más.
          </span>
        </div>
        <Turnstile onToken={onToken} resetKey={captchaReset} />
        <button className="button" type="submit" disabled={busy || !captchaToken}>
          {busy ? 'Creando cuenta…' : 'Crear cuenta'}
        </button>
      </form>
      <p className="muted">
        ¿Ya tienes cuenta? <Link href="/ingresar">Inicia sesión</Link>
      </p>
    </AuthShell>
  );
}
