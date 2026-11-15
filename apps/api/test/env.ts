// Se carga antes de cada archivo de prueba: las pruebas siempre usan la base apuestas_test.
try {
  process.loadEnvFile('../../.env');
} catch {
  // en CI no hay .env; las variables vienen del workflow
}

process.env.API_FOOTBALL_KEY = '';
process.env.API_FOOTBALL_DAILY_BUDGET = '';
process.env.API_FOOTBALL_BOOKMAKER_ID = '';

if (!process.env.TEST_DATABASE_URL) throw new Error('Falta TEST_DATABASE_URL');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'secreto-solo-para-pruebas';
process.env.TOTP_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
// Todas las peticiones de prueba salen de la misma IP; el límite por IP no debe interferir.
process.env.THROTTLE_LIMIT = '10000';
// Las pruebas llaman a la API directo, sin el proxy /api de la web.
process.env.PUBLIC_API_PREFIX = '';
process.env.REDIS_URL ??= 'redis://localhost:6379';
// Prefijo de BullMQ propio de esta corrida: las pruebas no ven trabajos de la app de desarrollo.
process.env.BULLMQ_PREFIX = `test-${process.pid}`;
process.env.CATALOG_MODE ??= 'simulated';
