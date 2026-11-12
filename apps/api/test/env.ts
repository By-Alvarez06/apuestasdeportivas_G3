// Se carga antes de cada archivo de prueba: las pruebas siempre usan la base apuestas_test.
try {
  process.loadEnvFile('../../.env');
} catch {
  // en CI no hay .env; las variables vienen del workflow
}

if (!process.env.TEST_DATABASE_URL) throw new Error('Falta TEST_DATABASE_URL');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
