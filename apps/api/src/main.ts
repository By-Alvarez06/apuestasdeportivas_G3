import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PORTS } from '@apuestas/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL || `http://localhost:${PORTS.WEB}`,
    credentials: true,
  });

  const port = process.env.PORT || PORTS.API;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}`);
}

bootstrap();
