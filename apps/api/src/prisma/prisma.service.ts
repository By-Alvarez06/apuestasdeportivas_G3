import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// 'minimal': los errores no incluyen los argumentos de la consulta (p. ej. un passwordHash) en los logs.
const options = (connectionString: string) => ({
  adapter: new PrismaPg({ connectionString }),
  errorFormat: 'minimal' as const,
});

/** Crea un cliente de Prisma 7 sobre el driver `pg`. Lo usan la app, el seed y las pruebas. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient(options(connectionString));
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super(options(config.getOrThrow<string>('DATABASE_URL')));
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
