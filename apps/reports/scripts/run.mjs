// Ejecuta una herramienta de Python (ruff, pytest, python) igual en Windows, macOS y Linux.
// Busca primero en el entorno virtual (.venv/bin en Unix, .venv\Scripts en Windows) y luego en el
// PATH. Si no la encuentra, avisa y termina sin error, como hacían los scripts anteriores.
//
// Uso: node scripts/run.mjs <herramienta> [argumentos...]
//      node scripts/run.mjs clean
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [tool, ...args] = process.argv.slice(2);
const isWindows = process.platform === 'win32';

if (!tool) {
  console.error('Uso: node scripts/run.mjs <herramienta> [argumentos...]');
  process.exit(2);
}

if (tool === 'clean') {
  removePycache('.');
  process.exit(0);
}

// En Windows, `python3` suele ser el acceso directo de la Microsoft Store: se prueba `python` primero.
const names = tool === 'python' ? (isWindows ? ['python', 'python3'] : ['python3', 'python']) : [tool];
const venvBin = isWindows ? join('.venv', 'Scripts') : join('.venv', 'bin');
const candidates = [
  ...names.map((name) => join(venvBin, isWindows ? `${name}.exe` : name)).filter(existsSync),
  ...names,
];

for (const command of candidates) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

console.log(`${tool} no encontrado, se omite (instala las dependencias de apps/reports).`);

function removePycache(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.venv' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.name === '__pycache__') rmSync(path, { recursive: true, force: true });
    else removePycache(path);
  }
}
