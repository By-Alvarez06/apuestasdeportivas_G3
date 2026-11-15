import { Injectable } from '@nestjs/common';
import { MarketStatus, MatchStatus, OddsSource, type MarketType } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CatalogMatch,
  MatchCatalogPort,
  MarketStatus as CatalogMarketStatus,
  MatchStatus as CatalogMatchStatus,
  OddsPoint,
  SelectionQuote,
} from './match-catalog.port';

const MATCH_INCLUDE = {
  competition: { select: { name: true } },
  homeTeam: { select: { name: true, logoUrl: true } },
  awayTeam: { select: { name: true, logoUrl: true } },
  markets: {
    where: { status: MarketStatus.OPEN },
    include: {
      selections: {
        where: { isActive: true },
        orderBy: { updatedAt: 'desc' as const },
      },
    },
    orderBy: [{ type: 'asc' as const }, { line: 'asc' as const }],
  },
} satisfies Prisma.MatchInclude;

const SELECTION_INCLUDE = {
  market: {
    include: {
      match: {
        include: {
          competition: { select: { name: true } },
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      },
    },
  },
} satisfies Prisma.SelectionInclude;

const MARKET_LABELS: Record<MarketType, string> = {
  RESULT_1X2: 'Resultado del partido',
  DOUBLE_CHANCE: 'Doble oportunidad',
  TOTAL_GOALS: 'Total de goles',
  BOTH_TEAMS_SCORE: 'Ambos equipos marcan',
};

const MARKET_STATUS: Record<MarketStatus, CatalogMarketStatus> = {
  [MarketStatus.OPEN]: 'OPEN',
  [MarketStatus.SUSPENDED]: 'SUSPENDED',
  [MarketStatus.CLOSED]: 'CLOSED',
};

const MATCH_STATUS: Record<MatchStatus, CatalogMatchStatus> = {
  [MatchStatus.SCHEDULED]: 'SCHEDULED',
  [MatchStatus.LIVE]: 'LIVE',
  [MatchStatus.FINISHED]: 'FINISHED',
  [MatchStatus.SUSPENDED]: 'SUSPENDED',
  [MatchStatus.POSTPONED]: 'POSTPONED',
  [MatchStatus.CANCELLED]: 'CANCELLED',
};

type MatchRecord = Prisma.MatchGetPayload<{ include: typeof MATCH_INCLUDE }>;
type SelectionRecord = Prisma.SelectionGetPayload<{ include: typeof SELECTION_INCLUDE }>;

/** Lee cuotas y partidos desde la base de Spec 3 para apuestas, sin usar fixtures simulados. */
@Injectable()
export class PrismaMatchCatalog implements MatchCatalogPort {
  constructor(private readonly prisma: PrismaService) {}

  async getQuotes(selectionIds: readonly string[]): Promise<SelectionQuote[]> {
    if (selectionIds.length === 0) return [];
    const rows = await this.prisma.selection.findMany({
      where: { id: { in: [...new Set(selectionIds)] }, isActive: true },
      include: SELECTION_INCLUDE,
    });

    return rows.map((selection) => this.toQuote(selection));
  }

  async oddsHistory(selectionId: string, from: Date, to: Date): Promise<OddsPoint[]> {
    const rows = await this.prisma.oddsHistory.findMany({
      where: { selectionId, createdAt: { gte: from, lte: to } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true, newOdds: true },
    });
    return rows.map(({ createdAt, newOdds }) => ({
      at: createdAt,
      odds: toHundredths(newOdds.toString()),
    }));
  }

  async listOpenMatches(): Promise<CatalogMatch[]> {
    const now = new Date();
    const matches = await this.prisma.match.findMany({
      where: {
        OR: [
          { status: MatchStatus.LIVE },
          { status: MatchStatus.SCHEDULED, kickoffAt: { gte: now } },
        ],
        markets: {
          some: {
            status: MarketStatus.OPEN,
            selections: { some: { isActive: true } },
          },
        },
      },
      include: MATCH_INCLUDE,
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    return matches.map((match) => this.toCatalogMatch(match));
  }

  private toQuote(selection: SelectionRecord): SelectionQuote {
    const {
      market,
      market: { match },
    } = selection;
    return {
      selectionId: selection.id,
      marketId: market.id,
      matchId: match.id,
      odds: toHundredths(selection.odds.toString()),
      marketStatus: MARKET_STATUS[market.status],
      matchStatus: MATCH_STATUS[match.status],
      startsAt: match.kickoffAt,
      liveBettingEnabled: match.status === MatchStatus.LIVE && market.status === MarketStatus.OPEN,
      labels: {
        match: this.matchLabel(match),
        market: this.marketLabel(market.type, market.line?.toString() ?? null),
        selection: selection.label,
      },
    };
  }

  private toCatalogMatch(match: MatchRecord): CatalogMatch {
    const markets = match.markets.flatMap((market) => {
      const byKey = new Map<string, (typeof market.selections)[number]>();
      for (const selection of market.selections) {
        const current = byKey.get(selection.key);
        if (!current || selection.source === OddsSource.MANUAL) byKey.set(selection.key, selection);
      }
      const selections = [...byKey.values()].map((selection) => ({
        selectionId: selection.id,
        label: selection.label,
        odds: toHundredths(selection.odds.toString()),
      }));
      if (selections.length === 0) return [];
      return [
        {
          marketId: market.id,
          label: this.marketLabel(market.type, market.line?.toString() ?? null),
          status: MARKET_STATUS[market.status],
          live: match.status === MatchStatus.LIVE,
          selections,
        },
      ];
    });
    return {
      matchId: match.id,
      label: this.matchLabel(match),
      startsAt: match.kickoffAt,
      status: MATCH_STATUS[match.status],
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      markets,
    };
  }

  private marketLabel(type: MarketType, line: string | null): string {
    if (type === 'TOTAL_GOALS' && line) return `Total de goles (${line})`;
    return MARKET_LABELS[type];
  }

  private matchLabel(match: {
    competition: { name: string } | null;
    homeTeam: { name: string };
    awayTeam: { name: string };
  }) {
    const teams = `${match.homeTeam.name} - ${match.awayTeam.name}`;
    return match.competition ? `${match.competition.name} · ${teams}` : teams;
  }
}

function toHundredths(value: string): number {
  const [whole = '', fractional = ''] = value.split('.');
  const digits = fractional.padEnd(3, '0');
  const hundredths = Number(whole) * 100 + Number(digits.slice(0, 2));
  const rounded = hundredths + (Number(digits[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(rounded) || rounded < 101)
    throw new RangeError(`Cuota inválida en el catálogo: ${value}`);
  return rounded;
}
