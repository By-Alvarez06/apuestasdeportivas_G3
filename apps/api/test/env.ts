// Se carga antes de cada archivo de prueba: las pruebas siempre usan la base apuestas_test.
try {
  process.loadEnvFile('../../.env');
} catch {
  // en CI no hay .env; las variables vienen del workflow
}

if (!process.env.TEST_DATABASE_URL) throw new Error('Falta TEST_DATABASE_URL');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'secreto-solo-para-pruebas';
process.env.TOTP_ENC_KEY ??= Buffer.alloc(32, 7).toString('base64');
// Todas las peticiones de prueba salen de la misma IP; el límite por IP no debe interferir.
process.env.THROTTLE_LIMIT = '10000';
