import { execFileSync } from 'node:child_process';
import './env';

// Aplica las migraciones a apuestas_test una vez por corrida.
export default function globalSetup(): void {
  execFileSync(
    process.execPath,
    [require.resolve('../node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
}
