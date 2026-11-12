import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PORTS } from '@apuestas/shared';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL || `http://localhost:${PORTS.WEB}`,
    credentials: true,
  });
  app.use(cookieParser());
  // Rechaza campos que no estén en el DTO: el cliente no puede colar montos, roles ni estados.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.API_PORT || PORTS.API;
  await app.listen(port);
  console.log(`🚀 API running on http://localhost:${port}`);
}

bootstrap();
