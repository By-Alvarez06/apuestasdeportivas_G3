'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ErrorCode, UserRole } from '@apuestas/shared';
import { api, ApiError } from '@/lib/api';
import { usd } from '@/lib/format';
import styles from './AppShell.module.css';
import { LiveProvider, useLive } from './LiveProvider';

export interface Me {
  id: string;
  email: string;
  role: UserRole;
  status: 'UNVERIFIED' | 'ACTIVE' | 'SUSPENDED';
  twoFactorEnabled: boolean;
}

const SessionContext = createContext<{ me: Me; reload: () => void } | null>(null);

/** Usuario de la sesión actual; solo dentro de AppShell. */
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession fuera de AppShell');
  return value;
}

const NAV: { href: string; label: string; roles: UserRole[] }[] = [
  { href: '/apuestas', label: 'Apostar', roles: [UserRole.BETTOR] },
  { href: '/mis-apuestas', label: 'Mis apuestas', roles: [UserRole.BETTOR] },
  { href: '/promociones', label: 'Promociones', roles: [UserRole.BETTOR] },
  {
    href: '/operador/partidos',
    label: 'Partidos',
    roles: [UserRole.OPERATOR, UserRole.ADMIN],
  },
  {
    href: '/operador/reportes',
    label: 'Informes',
    roles: [UserRole.OPERATOR, UserRole.ADMIN],
  },
  { href: '/billetera', label: 'Billetera', roles: [UserRole.BETTOR] },
  {
    href: '/operador/cupones',
    label: 'Cupones',
    roles: [UserRole.OPERATOR, UserRole.ADMIN],
  },
  {
    href: '/operador/partidos-en-espera',
    label: 'Partidos en espera',
    roles: [UserRole.OPERATOR, UserRole.ADMIN],
  },
  {
    href: '/operador/ajustes',
    label: 'Ajustes de apuestas',
    roles: [UserRole.OPERATOR, UserRole.ADMIN],
  },
  { href: '/admin/usuarios', label: 'Usuarios', roles: [UserRole.ADMIN] },
  { href: '/admin/retiros', label: 'Retiros', roles: [UserRole.ADMIN] },
  { href: '/admin/fraude', label: 'Fraude', roles: [UserRole.ADMIN] },
  { href: '/admin/auditoria', label: 'Auditoría', roles: [UserRole.ADMIN] },
  {
    href: '/cuenta/seguridad',
    label: 'Seguridad',
    roles: [UserRole.BETTOR, UserRole.OPERATOR, UserRole.ADMIN],
  },
];

/** Marco de las pantallas con sesión: exige sesión y, si se indica, uno de los roles. */
export function AppShell({ roles, children }: { roles?: UserRole[]; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.code === ErrorCode.UNAUTHENTICATED)
          router.replace(`/ingresar?volver=${encodeURIComponent(pathname)}`);
      });
  }, [router, pathname, version]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/ingresar');
  }

  if (!me)
    return (
      <p className={styles.loading} role="status">
        Cargando tu cuenta…
      </p>
    );

  const allowed = !roles || roles.includes(me.role);
  const bettor = me.role === UserRole.BETTOR;

  const shell = (
    <SessionContext.Provider value={{ me, reload: () => setVersion((v) => v + 1) }}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Apuestas Deportivas
        </Link>
        {bettor && <Balance />}
        <nav aria-label="Principal" className={styles.nav}>
          {NAV.filter((item) => item.roles.includes(me.role)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
          <button type="button" className={styles.logout} onClick={logout}>
            Cerrar sesión
          </button>
        </nav>
      </header>
      <main className={styles.main}>
        {allowed ? (
          children
        ) : (
          <p className="notice" data-tone="error">
            No tienes acceso a esta sección.
          </p>
        )}
      </main>
    </SessionContext.Provider>
  );

  // Solo los apostadores reciben avisos en vivo de sus apuestas y su saldo.
  return bettor ? <LiveProvider>{shell}</LiveProvider> : shell;
}

/** Saldo disponible en la cabecera; cambia al instante cuando se liquida una apuesta. */
function Balance() {
  const [real, setReal] = useState<string | null>(null);

  useEffect(() => {
    api<{ real: string }>('/wallet')
      .then((w) => setReal(w.real))
      .catch(() => setReal(null));
  }, []);
  useLive('wallet.updated', (w) => setReal(w.real));

  if (real === null) return null;
  return (
    <Link href="/billetera" className={styles.balance}>
      <span className="visually-hidden">Saldo disponible: </span>
      {usd(real)}
    </Link>
  );
}
