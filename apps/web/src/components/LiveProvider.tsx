'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { type LiveEvents, LiveClient } from '@/lib/live';

const LiveContext = createContext<LiveClient | null>(null);

/** Abre la conexión en vivo mientras haya un apostador con sesión. */
export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new LiveClient());

  useEffect(() => {
    client.connect();
    return () => client.disconnect();
  }, [client]);

  return <LiveContext.Provider value={client}>{children}</LiveContext.Provider>;
}

/**
 * Escucha un evento en vivo. Fuera de LiveProvider (operadores, administradores) no hace nada.
 * El manejador más reciente se usa siempre, sin volver a suscribirse en cada render.
 */
export function useLive<K extends keyof LiveEvents>(
  event: K,
  handler: (payload: LiveEvents[K]) => void,
): void {
  const client = useContext(LiveContext);
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!client) return;
    return client.on(event, (payload) => latest.current(payload));
  }, [client, event]);
}
