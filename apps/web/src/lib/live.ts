import { io, type Socket } from 'socket.io-client';
import { refreshSession } from './api';
import type { BetView, BonusView } from './bets';

/** Eventos de contracts/realtime.md. */
export interface LiveEvents {
  'bet.updated': { bet: BetView; version: number };
  'wallet.updated': { real: string; bonus: string; held: string };
  'bonus.updated': BonusView;
  /** Se reconectó tras una caída: los avisos perdidos se recuperan recargando. */
  resync: undefined;
}

type Listener<K extends keyof LiveEvents> = (payload: LiveEvents[K]) => void;

/**
 * Conexión en vivo del apostador. Pasa por el mismo dominio de la web (proxy /socket.io) para que
 * viaje la cookie de sesión. Si el token vence, renueva la sesión y reconecta; al reconectar emite
 * `resync` para que cada pantalla recargue lo que pudo perderse.
 */
export class LiveClient {
  private socket: Socket | null = null;
  private readonly listeners = new Map<keyof LiveEvents, Set<Listener<never>>>();
  /** Última versión vista por apuesta: los avisos viejos que lleguen tarde se descartan. */
  private readonly versions = new Map<string, number>();
  private connectedOnce = false;
  private renewing = false;

  connect(): void {
    if (this.socket) return;
    // Sin barra final: el proxy de Next redirige /socket.io/ a /socket.io.
    const socket = io('/live', {
      path: '/socket.io',
      addTrailingSlash: false,
      withCredentials: true,
    });
    this.socket = socket;

    socket.on('connect', () => {
      if (this.connectedOnce) this.emit('resync', undefined);
      this.connectedOnce = true;
    });
    socket.on('bet.updated', (payload: LiveEvents['bet.updated']) => {
      const seen = this.versions.get(payload.bet.id) ?? -1;
      if (payload.version < seen) return;
      this.versions.set(payload.bet.id, payload.version);
      this.emit('bet.updated', payload);
    });
    socket.on('wallet.updated', (payload: LiveEvents['wallet.updated']) =>
      this.emit('wallet.updated', payload),
    );
    socket.on('bonus.updated', (payload: LiveEvents['bonus.updated']) =>
      this.emit('bonus.updated', payload),
    );
    socket.on('session.expired', () => void this.renew());
    socket.on('connect_error', (err: Error & { data?: { code?: string } }) => {
      if (err.data?.code === 'UNAUTHENTICATED') void this.renew();
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connectedOnce = false;
  }

  on<K extends keyof LiveEvents>(event: K, listener: Listener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<never>);
  }

  private emit<K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as Listener<K>)(payload);
  }

  /** Renueva la sesión una vez y vuelve a conectar; si no se puede, se queda desconectado. */
  private async renew(): Promise<void> {
    if (this.renewing || !this.socket) return;
    this.renewing = true;
    try {
      if (await refreshSession()) {
        this.socket.disconnect();
        this.socket.connect();
      }
    } finally {
      this.renewing = false;
    }
  }
}
