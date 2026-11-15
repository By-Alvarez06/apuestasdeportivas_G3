import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="stack">
      <h1>Apuestas Deportivas</h1>
      <p className="muted">Consulta los partidos, estados, mercados y cuotas disponibles.</p>
      <Link className="button" href="/apuestas">
        Ver partidos y apostar
      </Link>
      <p className="muted">
        <Link href="/registro">Crear cuenta</Link>
        {' · '}
        <Link href="/ingresar">Inicia sesión</Link>
      </p>
    </main>
  );
}
