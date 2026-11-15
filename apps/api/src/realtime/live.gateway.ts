import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { PORTS } from '@apuestas/shared';
import { ACCESS_COOKIE } from '../common/auth/auth.guard';
import { SessionVerifier } from '../common/auth/session-verifier';

const webUrl = () => process.env.WEB_URL ?? `http://localhost:${PORTS.WEB}`;

/** Valor de una cookie del handshake (sin dependencias: solo se necesita una). */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function unauthenticated(): Error & { data: { code: string } } {
  return Object.assign(new Error('UNAUTHENTICATED'), { data: { code: 'UNAUTHENTICATED' } });
}

/** Sala privada de cada usuario: solo sus sockets la integran. */
export const userRoom = (userId: string) => `user:${userId}`;

interface SocketData {
  userId: string;
  /** Vencimiento del token de acceso (segundos epoch). */
  exp?: number;
  expiry?: NodeJS.Timeout;
}

/**
 * Tiempo real para el apostador (contracts/realtime.md, FR-017). La conexión se autentica con la
 * cookie de sesión, igual que la API HTTP; cada socket entra solo a la sala de su usuario y no
 * existe ningún evento para unirse a otras salas.
 */
@WebSocketGateway({
  namespace: '/live',
  // Acepta /socket.io?EIO=… además de /socket.io/?EIO=…: el proxy de Next quita la barra final.
  addTrailingSlash: false,
  cors: {
    origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) =>
      cb(null, !origin || origin === webUrl()),
    credentials: true,
  },
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly sessions: SessionVerifier,
    private readonly jwt: JwtService,
  ) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      void this.authenticate(socket)
        .then(() => next())
        .catch(() => next(unauthenticated()));
    });
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as SocketData;
    void socket.join(userRoom(data.userId));
    if (data.exp) {
      // Al vencer el token, el cliente renueva la sesión y vuelve a conectar.
      data.expiry = setTimeout(
        () => {
          socket.emit('session.expired', { code: 'TOKEN_EXPIRED' });
          socket.disconnect(true);
        },
        Math.max(0, data.exp * 1000 - Date.now()),
      );
      data.expiry.unref();
      socket.on('disconnect', () => clearTimeout(data.expiry));
    }
  }

  /** Envía un evento a todas las pestañas abiertas del usuario. */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  private async authenticate(socket: Socket): Promise<void> {
    // Un navegador de otro sitio no puede abrir una conexión con la sesión del usuario.
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== webUrl()) throw new Error('origen no permitido');

    const token = cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const user = await this.sessions.verify(token);
    const { exp } = this.jwt.decode<{ exp?: number }>(token as string);
    Object.assign(socket.data as SocketData, { userId: user.id, exp });
    this.logger.debug(`Conexión en vivo de ${user.id}`);
  }
}
