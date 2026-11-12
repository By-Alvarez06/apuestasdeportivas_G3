import { execSync } from 'node:child_process';
import './env';

// Aplica las migraciones a apuestas_test una vez por corrida.
export default function globalSetup(): void {
  execSync('pnpm exec prisma migrate deploy', { stdio: 'inherit', env: process.env });
}
