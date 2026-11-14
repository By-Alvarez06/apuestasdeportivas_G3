# Servicio de informes operativos

Servicio FastAPI de solo lectura para el dashboard de partidos, cuotas y actividad de operadores.
No se expone directamente al navegador: NestJS comprueba la sesión y el rol `OPERATOR`/`ADMIN`,
y después llama a este servicio con `REPORTS_SERVICE_TOKEN`.

## Configuración local

1. Define `REPORTS_SERVICE_TOKEN` con un secreto aleatorio largo, igual en el servicio de API y en
   este servicio.
2. Configura `REPORTS_DATABASE_URL` con una cuenta PostgreSQL que solo tenga permiso `SELECT` sobre
   las tablas de dominio. El pool fija `default_transaction_read_only=on` y cada consulta ejecuta
   además una transacción de solo lectura.
3. Configura `REPORTS_URL=http://localhost:8000` en la API.
4. Instala y ejecuta desde la raíz del monorepo:

   ```powershell
   uv sync --project apps/reports --extra dev
   corepack pnpm --filter @apuestas/reports dev
   ```

Las rutas `GET /dashboard` y `GET /export` aceptan `from` y `to` como fechas ISO-8601 con zona
horaria. Todas se normalizan a UTC; el periodo máximo es de 90 días y cada consulta/exportación
está limitada a 1.000 filas por conjunto de datos. El CSV usa UTF-8 con BOM y encabezados estables;
el PDF incluye periodo, filtros y fecha de generación.

El endpoint `/health` no requiere credenciales. Dashboard y exportación requieren
`Authorization: Bearer <REPORTS_SERVICE_TOKEN>`.
