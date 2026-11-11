import { APP_VERSION } from '@apuestas/shared';

export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
        textAlign: 'center',
        gap: '1.5rem',
      }}
    >
      <h1 style={{ fontSize: '2.5rem', fontWeight: 700 }}>⚽ Apuestas Deportivas</h1>
      <p style={{ color: '#888', maxWidth: '480px', lineHeight: 1.6 }}>
        Sistema web de apuestas deportivas — proyecto académico UTPL.
      </p>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <StatusBadge label="Web" href="/" />
        <StatusBadge label="API" href={`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/health`} />
        <StatusBadge label="Reports" href={`${process.env.NEXT_PUBLIC_REPORTS_URL || 'http://localhost:8000'}/health`} />
      </div>
      <p style={{ fontSize: '0.75rem', color: '#555' }}>v{APP_VERSION}</p>
    </main>
  );
}

function StatusBadge({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      style={{
        padding: '0.5rem 1.25rem',
        border: '1px solid #2a2a2a',
        borderRadius: '8px',
        fontSize: '0.875rem',
        transition: 'border-color 0.2s',
      }}
    >
      {label}
    </a>
  );
}
