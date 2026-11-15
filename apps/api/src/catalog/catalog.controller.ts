import { Controller, Get, Inject } from '@nestjs/common';
import { oddsToString } from '@apuestas/shared';
import { Roles } from '../common/auth/decorators';
import { Role } from '../generated/prisma/enums';
import { MATCH_CATALOG, type MatchCatalogPort } from './match-catalog.port';

/** Listado de partidos con cuotas vigentes para la pantalla de apuestas. */
@Roles(Role.BETTOR, Role.OPERATOR, Role.ADMIN)
@Controller('catalog')
export class CatalogController {
  constructor(@Inject(MATCH_CATALOG) private readonly catalog: MatchCatalogPort) {}

  @Get('matches')
  async matches() {
    const matches = await this.catalog.listOpenMatches();
    return matches.map((m) => ({
      matchId: m.matchId,
      label: m.label,
      startsAt: m.startsAt.toISOString(),
      status: m.status,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      markets: m.markets.map((mk) => ({
        marketId: mk.marketId,
        label: mk.label,
        status: mk.status,
        live: mk.live,
        selections: mk.selections.map((s) => ({
          selectionId: s.selectionId,
          label: s.label,
          odds: oddsToString(s.odds),
        })),
      })),
    }));
  }
}
