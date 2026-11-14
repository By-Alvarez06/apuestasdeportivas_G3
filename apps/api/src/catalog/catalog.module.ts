import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { MATCH_CATALOG } from './match-catalog.port';
import { DevCatalogController, DevOnlyGuard } from './simulated/dev-catalog.controller';
import { SimulatedCatalog } from './simulated/simulated-catalog';

/**
 * Catálogo de partidos para la spec 4 (research R2). Con `CATALOG_MODE=simulated` (único modo
 * mientras no exista la spec 3) provee el catálogo en memoria. Al integrar la spec 3, su módulo
 * proveerá MATCH_CATALOG y se borrará la carpeta `simulated/`.
 */
@Module({
  providers: [
    { provide: SimulatedCatalog, useFactory: () => new SimulatedCatalog() },
    DevOnlyGuard,
    {
      provide: MATCH_CATALOG,
      useFactory: (simulated: SimulatedCatalog) => {
        const mode = process.env.CATALOG_MODE ?? 'simulated';
        if (mode !== 'simulated')
          throw new Error(`CATALOG_MODE=${mode} no está disponible: la spec 3 aún no existe.`);
        return simulated;
      },
      inject: [SimulatedCatalog],
    },
  ],
  controllers: [CatalogController, DevCatalogController],
  exports: [MATCH_CATALOG, SimulatedCatalog],
})
export class CatalogModule {}
