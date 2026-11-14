import Link from 'next/link';
import styles from './AuthShell.module.css';

/** Área de penal en líneas de tiza: el único elemento decorativo de las pantallas de cuenta. */
function PenaltyBox() {
  return (
    <svg className={styles.pitch} viewBox="0 0 400 520" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <rect x="40" y="-4" width="320" height="250" />
        <rect x="130" y="-4" width="140" height="90" />
        <circle cx="200" cy="170" r="4" fill="currentColor" />
        <path d="M140 246 A 80 80 0 0 0 260 246" />
        <path d="M-10 520 L 410 520" />
        <circle cx="200" cy="520" r="90" />
      </g>
    </svg>
  );
}

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <aside className={styles.band}>
        <Link href="/" className={styles.brand}>
          Apuestas Deportivas
        </Link>
        <PenaltyBox />
        <p className={styles.note}>Proyecto académico UTPL. Pagos solo en entorno de pruebas.</p>
      </aside>
      <main className={styles.content}>
        <div className={styles.panel}>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
