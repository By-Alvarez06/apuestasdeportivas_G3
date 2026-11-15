import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { MATCH_CATALOG } from './match-catalog.port';
import { MatchesModule } from '../matches/matches.module';
import { PrismaMatchCatalog } from './prisma-match-catalog';
import { DevCatalogController, DevOnlyGuard } from './simulated/dev-catalog.controller';
import { SimulatedCatalog } from './simulated/simulated-catalog';

@Module({
  imports: [MatchesModule],
  providers: [
    PrismaMatchCatalog,
    { provide: SimulatedCatalog, useFactory: () => new SimulatedCatalog() },
    DevOnlyGuard,
    {
      provide: MATCH_CATALOG,
      useFactory: (database: PrismaMatchCatalog, simulated: SimulatedCatalog) => {
        const mode = process.env.CATALOG_MODE ?? 'database';
        if (mode === 'database') return database;
        if (mode === 'simulated' && process.env.NODE_ENV !== 'production') return simulated;
        if (mode === 'simulated')
          throw new Error('El catálogo simulado no está permitido en producción.');
        throw new Error(`CATALOG_MODE=${mode} no es válido; usa database o simulated.`);
      },
      inject: [PrismaMatchCatalog, SimulatedCatalog],
    },
  ],
  controllers: [CatalogController, DevCatalogController],
  exports: [MATCH_CATALOG, SimulatedCatalog],
})
export class CatalogModule {}
