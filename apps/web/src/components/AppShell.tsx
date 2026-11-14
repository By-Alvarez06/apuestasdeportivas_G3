'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ErrorCode, UserRole } from '@apuestas/shared';
import { api, ApiError } from '@/lib/api';
import styles from './AppShell.module.css';

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
  { href: '/billetera', label: 'Billetera', roles: [UserRole.BETTOR] },
  { href: '/admin/usuarios', label: 'Usuarios', roles: [UserRole.ADMIN] },
  { href: '/admin/retiros', label: 'Retiros', roles: [UserRole.ADMIN] },
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

  return (
    <SessionContext.Provider value={{ me, reload: () => setVersion((v) => v + 1) }}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          Apuestas Deportivas
        </Link>
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
}
