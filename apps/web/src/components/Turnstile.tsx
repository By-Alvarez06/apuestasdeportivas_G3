'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/**
 * Verificación anti-bots de Cloudflare Turnstile (FR-005). Sin retos visuales en la mayoría de
 * casos, lo que ayuda a WCAG AA. `resetKey` cambia para pedir un token nuevo tras cada intento.
 */
export function Turnstile({
  onToken,
  resetKey,
}: {
  onToken: (token: string) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && !!window.turnstile);

  const render = useCallback(() => {
    if (!container.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: SITE_KEY,
      language: 'es',
      theme: 'light',
      callback: onToken,
      'expired-callback': () => onToken(''),
    });
  }, [onToken]);

  useEffect(() => {
    if (ready) render();
  }, [ready, render]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      onToken('');
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey, onToken]);

  useEffect(
    () => () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      // Sin esto, el remontaje de StrictMode (o volver a la página) no vuelve a dibujar el CAPTCHA.
      widgetId.current = null;
    },
    [],
  );

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={container} />
    </>
  );
}
