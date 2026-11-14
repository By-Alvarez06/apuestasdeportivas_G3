import Link from 'next/link';
import { AuthShell } from '@/components/AuthShell';

export default function HomePage() {
  return (
    <AuthShell title="Apuesta al fútbol con saldo de prueba">
      <p className="muted">
        Crea tu cuenta, deposita en el entorno de pruebas de Payphone y sigue tus movimientos al
        centavo.
      </p>
      <div className="stack">
        <Link className="button" href="/registro">
          Crear cuenta
        </Link>
        <p className="muted">
          ¿Ya tienes cuenta? <Link href="/ingresar">Inicia sesión</Link>
        </p>
      </div>
    </AuthShell>
  );
}
