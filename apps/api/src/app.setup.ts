import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { PORTS } from '@apuestas/shared';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { originCheck } from './common/origin-check.middleware';

/** Configuración HTTP común a main.ts y a las pruebas de integración. */
export function configureApp(app: NestExpressApplication): void {
  const webUrl = app.get(ConfigService).get<string>('WEB_URL', `http://localhost:${PORTS.WEB}`);

  // Render pone un proxy delante: la IP real del cliente (auditoría, rate limiting) viene en X-Forwarded-For.
  app.set('trust proxy', 1);
  // Cabeceras de seguridad (HSTS, nosniff, frame-ancestors, etc.); OWASP A05.
  app.use(helmet());
  app.enableCors({ origin: webUrl, credentials: true });
  app.use(cookieParser());
  app.use(originCheck(webUrl));
  // Rechaza campos que no estén en el DTO: el cliente no puede colar montos, roles ni estados.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
}
