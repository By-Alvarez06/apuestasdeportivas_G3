import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MarketStatus as PublicMarketStatus,
  MarketType as PublicMarketType,
  MatchStatus as PublicMatchStatus,
  OddsSource as PublicOddsSource,
  ErrorCode,
  type MatchSummary,
} from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, notFound, validationError } from '../common/errors/domain-error';
import { type RequestMeta } from '../common/request-meta';
import { MarketStatus, MarketType, MatchStatus, OddsSource, Role } from '../generated/prisma/enums';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { MatchEventJob } from '../catalog/match-catalog.port';
import {
  createMarketResultEvents,
  createMatchStatusEvent,
  MatchEventPublisher,
} from './match-event.publisher';
import {
  assertDecimalOdds,
  assertMarketLine,
  assertMarketOutcomes,
  marketOutcomes,
  MarketRuleError,
} from './market-outcomes';
import { assertMatchTransition, assertValidScore, MatchRuleError } from './match-state';
import type {
  CreateCompetitionDto,
  CreateMarketDto,
  CreateMatchDto,
  MatchFiltersDto,
  MatchStatusDto,
  SetOddsDto,
  UpdateCompetitionDto,
  UpdateMatchDto,
} from './matches.dto';

const MATCH_INCLUDE = {
  competition: { select: { id: true, name: true, country: true } },
  homeTeam: { select: { id: true, name: true, logoUrl: true } },
  awayTeam: { select: { id: true, name: true, logoUrl: true } },
  markets: {
    include: { selections: { orderBy: { updatedAt: 'desc' as const } } },
    orderBy: [{ type: 'asc' as const }, { line: 'asc' as const }],
  },
} satisfies Prisma.MatchInclude;

const PUBLIC_MATCH_INCLUDE = {
  ...MATCH_INCLUDE,
  markets: {
    where: { status: MarketStatus.OPEN },
    include: {
      selections: {
        where: { isActive: true },
        orderBy: { updatedAt: 'desc' as const },
      },
    },
    orderBy: MATCH_INCLUDE.markets.orderBy,
  },
} satisfies Prisma.MatchInclude;

type MatchRecord = Prisma.MatchGetPayload<{ include: typeof MATCH_INCLUDE }>;
type Transaction = Prisma.TransactionClient;

const matchStatusToDatabase: Record<PublicMatchStatus, MatchStatus> = {
  [PublicMatchStatus.SCHEDULED]: MatchStatus.SCHEDULED,
  [PublicMatchStatus.LIVE]: MatchStatus.LIVE,
  [PublicMatchStatus.FINISHED]: MatchStatus.FINISHED,
  [PublicMatchStatus.SUSPENDED]: MatchStatus.SUSPENDED,
  [PublicMatchStatus.POSTPONED]: MatchStatus.POSTPONED,
  [PublicMatchStatus.CANCELLED]: MatchStatus.CANCELLED,
};

const matchStatusToPublic: Record<MatchStatus, PublicMatchStatus> = {
  [MatchStatus.SCHEDULED]: PublicMatchStatus.SCHEDULED,
  [MatchStatus.LIVE]: PublicMatchStatus.LIVE,
  [MatchStatus.FINISHED]: PublicMatchStatus.FINISHED,
  [MatchStatus.SUSPENDED]: PublicMatchStatus.SUSPENDED,
  [MatchStatus.POSTPONED]: PublicMatchStatus.POSTPONED,
  [MatchStatus.CANCELLED]: PublicMatchStatus.CANCELLED,
};

const marketTypeToDatabase: Record<PublicMarketType, MarketType> = {
  [PublicMarketType.RESULT_1X2]: MarketType.RESULT_1X2,
  [PublicMarketType.DOUBLE_CHANCE]: MarketType.DOUBLE_CHANCE,
  [PublicMarketType.TOTAL_GOALS]: MarketType.TOTAL_GOALS,
  [PublicMarketType.BOTH_TEAMS_SCORE]: MarketType.BOTH_TEAMS_SCORE,
};

const marketTypeToPublic: Record<MarketType, PublicMarketType> = {
  [MarketType.RESULT_1X2]: PublicMarketType.RESULT_1X2,
  [MarketType.DOUBLE_CHANCE]: PublicMarketType.DOUBLE_CHANCE,
  [MarketType.TOTAL_GOALS]: PublicMarketType.TOTAL_GOALS,
  [MarketType.BOTH_TEAMS_SCORE]: PublicMarketType.BOTH_TEAMS_SCORE,
};

const marketStatusToPublic: Record<MarketStatus, PublicMarketStatus> = {
  [MarketStatus.OPEN]: PublicMarketStatus.OPEN,
  [MarketStatus.SUSPENDED]: PublicMarketStatus.SUSPENDED,
  [MarketStatus.CLOSED]: PublicMarketStatus.CLOSED,
};

const oddsSourceToPublic: Record<OddsSource, PublicOddsSource> = {
  [OddsSource.MANUAL]: PublicOddsSource.MANUAL,
  [OddsSource.API_FOOTBALL]: PublicOddsSource.API_FOOTBALL,
};

const isLiveEligible = (status: MatchStatus) =>
  status === MatchStatus.SCHEDULED || status === MatchStatus.LIVE;

const conflict = (message: string) =>
  new DomainError(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT);

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly matchEvents: MatchEventPublisher,
  ) {}

  async listPublic(filters: MatchFiltersDto) {
    this.validateDateRange(filters);
    const where = this.publicWhere(filters);
    const pageSize = Math.min(filters.pageSize, 20);
    const total = await this.prisma.match.count({ where });
    const rows = await this.prisma.match.findMany({
      where,
      include: PUBLIC_MATCH_INCLUDE,
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((match) => this.serializeMatch(match, false)),
      total,
      page: filters.page,
      pageSize,
    };
  }

  async listForOperator(filters: MatchFiltersDto) {
    this.validateDateRange(filters);
    const where: Prisma.MatchWhereInput = {
      status: filters.status ? matchStatusToDatabase[filters.status] : undefined,
      competitionId: filters.competitionId,
      kickoffAt: this.kickoffFilter(filters),
    };
    const total = await this.prisma.match.count({ where });
    const rows = await this.prisma.match.findMany({
      where,
      include: MATCH_INCLUDE,
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    });
    return {
      items: rows.map((match) => this.serializeMatch(match, true)),
      total,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  async getPublic(id: string): Promise<MatchSummary> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: {
        ...MATCH_INCLUDE,
        markets: {
          ...MATCH_INCLUDE.markets,
          where: { status: MarketStatus.OPEN },
          include: {
            selections: {
              where: { isActive: true },
              orderBy: { updatedAt: 'desc' },
            },
          },
        },
      },
    });
    if (!match || match.status === MatchStatus.CANCELLED)
      throw notFound('No encontramos ese partido.');
    return this.serializeMatch(match, false);
  }

  async getForOperator(id: string): Promise<MatchSummary> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });
    if (!match) throw notFound('No encontramos ese partido.');
    return this.serializeMatch(match, true);
  }

  async listCompetitions() {
    return this.prisma.competition.findMany({
      select: { id: true, name: true, country: true },
      orderBy: [{ name: 'asc' }, { country: 'asc' }],
    });
  }

  async listPublicFilters(filters: MatchFiltersDto) {
    this.validateDateRange(filters);
    const competitionsWhere = this.publicWhere(filters, 'competition');
    const statusesWhere = this.publicWhere(filters, 'status');
    const [competitions, groupedStatuses] = await Promise.all([
      this.prisma.competition.findMany({
        where: { matches: { some: competitionsWhere } },
        select: {
          id: true,
          name: true,
          country: true,
          _count: { select: { matches: { where: competitionsWhere } } },
        },
        orderBy: [{ name: 'asc' }, { country: 'asc' }],
      }),
      this.prisma.match.groupBy({
        by: ['status'],
        where: statusesWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      competitions: competitions.map(({ _count, ...competition }) => ({
        ...competition,
        count: _count.matches,
      })),
      statuses: groupedStatuses
        .filter(({ status }) => status === MatchStatus.SCHEDULED || status === MatchStatus.LIVE)
        .map(({ status, _count }) => ({
          value: matchStatusToPublic[status],
          label: status === MatchStatus.LIVE ? 'En vivo' : 'Programado',
          count: _count._all,
        })),
    };
  }

  async createCompetition(actorId: string, dto: CreateCompetitionDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const competition = await tx.competition.create({
        data: {
          name: dto.name.trim(),
          country: dto.country?.trim() || null,
          logoUrl: dto.logoUrl?.trim() || null,
        },
        select: { id: true, name: true, country: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'match.competition.created',
          targetType: 'competition',
          targetId: competition.id,
          metadata: { name: competition.name },
          ...meta,
        },
        tx,
      );
      return competition;
    });
  }

  async updateCompetition(
    actorId: string,
    id: string,
    dto: UpdateCompetitionDto,
    meta: RequestMeta,
  ) {
    if (dto.name === undefined && dto.country === undefined && dto.logoUrl === undefined) {
      throw validationError('Indica al menos un campo para actualizar.');
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.competition.findUnique({ where: { id } });
      if (!current) throw notFound('No encontramos la competición.');
      const competition = await tx.competition.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          country: dto.country === undefined ? undefined : dto.country.trim() || null,
          logoUrl: dto.logoUrl === undefined ? undefined : dto.logoUrl.trim() || null,
        },
        select: { id: true, name: true, country: true },
      });
      await this.audit.record(
        {
          actorId,
          action: 'match.competition.updated',
          targetType: 'competition',
          targetId: id,
          metadata: {
            from: { name: current.name, country: current.country ?? '' },
            to: { name: competition.name, country: competition.country ?? '' },
          },
          ...meta,
        },
        tx,
      );
      return competition;
    });
  }

  async createMatch(actorId: string, dto: CreateMatchDto, meta: RequestMeta) {
    const homeTeamName = dto.homeTeamName.trim();
    const awayTeamName = dto.awayTeamName.trim();
    if (homeTeamName.toLocaleLowerCase() === awayTeamName.toLocaleLowerCase()) {
      throw validationError('Un partido debe tener dos equipos distintos.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (
        dto.competitionId &&
        !(await tx.competition.findUnique({ where: { id: dto.competitionId } }))
      ) {
        throw notFound('No encontramos la competición.');
      }
      const teams = await this.getOrCreateManualTeams([homeTeamName, awayTeamName], tx);
      const homeTeam = teams.get(this.normalizeTeamName(homeTeamName));
      const awayTeam = teams.get(this.normalizeTeamName(awayTeamName));
      if (!homeTeam || !awayTeam)
        throw new Error('No se pudieron resolver los equipos del partido.');
      const match = await tx.match.create({
        data: {
          competitionId: dto.competitionId,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoffAt: new Date(dto.kickoffAt),
        },
        include: MATCH_INCLUDE,
      });
      await this.audit.record(
        {
          actorId,
          action: 'match.created',
          targetType: 'match',
          targetId: match.id,
          metadata: { homeTeam: homeTeam.name, awayTeam: awayTeam.name },
          ...meta,
        },
        tx,
      );
      return this.serializeMatch(match, true);
    });
  }

  async updateMatch(actorId: string, id: string, dto: UpdateMatchDto, meta: RequestMeta) {
    if (
      dto.competitionId === undefined &&
      dto.homeTeamName === undefined &&
      dto.awayTeamName === undefined &&
      dto.kickoffAt === undefined
    ) {
      throw validationError('Indica al menos un campo para actualizar.');
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockMatch(id, tx);
      if (current.status === MatchStatus.FINISHED || current.status === MatchStatus.CANCELLED) {
        throw conflict('No se puede editar un partido terminado o cancelado.');
      }
      if (
        dto.competitionId &&
        !(await tx.competition.findUnique({ where: { id: dto.competitionId } }))
      ) {
        throw notFound('No encontramos la competición.');
      }
      const homeTeamName = dto.homeTeamName?.trim();
      const awayTeamName = dto.awayTeamName?.trim();
      const currentTeams = await tx.match.findUniqueOrThrow({
        where: { id },
        select: { homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
      });
      const effectiveHome = homeTeamName ?? currentTeams.homeTeam.name;
      const effectiveAway = awayTeamName ?? currentTeams.awayTeam.name;
      if (this.normalizeTeamName(effectiveHome) === this.normalizeTeamName(effectiveAway)) {
        throw validationError('Un partido debe tener dos equipos distintos.');
      }
      const teamNames = [homeTeamName, awayTeamName].filter((name): name is string => !!name);
      const teams = await this.getOrCreateManualTeams(teamNames, tx);
      const homeTeam = homeTeamName ? teams.get(this.normalizeTeamName(homeTeamName)) : undefined;
      const awayTeam = awayTeamName ? teams.get(this.normalizeTeamName(awayTeamName)) : undefined;
      await tx.match.update({
        where: { id },
        data: {
          competitionId: dto.competitionId,
          homeTeamId: homeTeam?.id,
          awayTeamId: awayTeam?.id,
          kickoffAt: dto.kickoffAt ? new Date(dto.kickoffAt) : undefined,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'match.updated',
          targetType: 'match',
          targetId: id,
          metadata: {
            homeTeam: homeTeam?.name ?? '',
            awayTeam: awayTeam?.name ?? '',
            kickoffAt: dto.kickoffAt ?? '',
            competitionId: dto.competitionId ?? '',
          },
          ...meta,
        },
        tx,
      );
      return this.serializeMatch(
        await tx.match.findUniqueOrThrow({ where: { id }, include: MATCH_INCLUDE }),
        true,
      );
    });
  }

  async changeStatus(
    actorId: string,
    id: string,
    role: Role,
    dto: MatchStatusDto,
    meta: RequestMeta,
  ) {
    if ((dto.homeScore === undefined) !== (dto.awayScore === undefined)) {
      throw validationError('Envía el marcador de ambos equipos.');
    }
    if (dto.status === PublicMatchStatus.FINISHED) {
      if (dto.homeScore === undefined || dto.awayScore === undefined) {
        throw validationError('Un partido finalizado requiere el marcador final.');
      }
      this.assertScore(dto.homeScore, dto.awayScore);
    } else if (dto.homeScore !== undefined && dto.awayScore !== undefined) {
      this.assertScore(dto.homeScore, dto.awayScore);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockMatch(id, tx);
      const next = matchStatusToDatabase[dto.status];
      this.assertTransition(current.status, next, role, dto.reason);
      const homeScore = dto.homeScore ?? current.homeScore;
      const awayScore = dto.awayScore ?? current.awayScore;
      await tx.match.update({
        where: { id },
        data: {
          status: next,
          homeScore: dto.homeScore,
          awayScore: dto.awayScore,
          statusSource: OddsSource.MANUAL,
        },
      });
      if (
        next === MatchStatus.SUSPENDED ||
        next === MatchStatus.POSTPONED ||
        next === MatchStatus.CANCELLED
      ) {
        await tx.market.updateMany({
          where: { matchId: id, status: MarketStatus.OPEN },
          data: { status: MarketStatus.SUSPENDED },
        });
      } else if (next === MatchStatus.FINISHED) {
        await tx.market.updateMany({
          where: { matchId: id, status: { not: MarketStatus.CLOSED } },
          data: { status: MarketStatus.CLOSED },
        });
      }
      const events: MatchEventJob[] = [];
      if (
        next === MatchStatus.FINISHED &&
        homeScore !== null &&
        awayScore !== null &&
        (current.status !== next ||
          current.homeScore !== homeScore ||
          current.awayScore !== awayScore)
      ) {
        const markets = await tx.market.findMany({
          where: { matchId: id },
          include: { selections: { select: { id: true, key: true } } },
        });
        events.push(
          ...createMarketResultEvents(
            id,
            markets,
            homeScore,
            awayScore,
            current.status === MatchStatus.FINISHED,
          ),
        );
      }
      if (current.status !== next) {
        events.push(createMatchStatusEvent(id, next, current.kickoffAt));
      }
      if (events.length > 0) await this.matchEvents.stage(tx, events);
      await this.audit.record(
        {
          actorId,
          action: 'match.status.changed',
          targetType: 'match',
          targetId: id,
          metadata: {
            from: current.status,
            to: next,
            homeScore: dto.homeScore ?? current.homeScore ?? -1,
            awayScore: dto.awayScore ?? current.awayScore ?? -1,
            reason: dto.reason?.trim() ?? '',
          },
          ...meta,
        },
        tx,
      );
      return this.serializeMatch(
        await tx.match.findUniqueOrThrow({ where: { id }, include: MATCH_INCLUDE }),
        true,
      );
    });
    await this.matchEvents.dispatchPending();
    return updated;
  }

  async createMarket(actorId: string, matchId: string, dto: CreateMarketDto, meta: RequestMeta) {
    try {
      assertMarketLine(dto.type, dto.line);
      assertMarketOutcomes(
        dto.type,
        dto.selections.map(({ key }) => key),
      );
      dto.selections.forEach(({ odds }) => assertDecimalOdds(odds));
    } catch (error) {
      if (error instanceof MarketRuleError) throw validationError(error.message);
      throw error;
    }
    const type = marketTypeToDatabase[dto.type];
    try {
      return await this.prisma.$transaction(async (tx) => {
        const match = await this.lockMatch(matchId, tx);
        if (!isLiveEligible(match.status)) {
          throw conflict('Solo se pueden crear mercados para partidos programados o en vivo.');
        }
        const market = await tx.market.create({
          data: {
            matchId,
            type,
            line: dto.line,
            status: MarketStatus.OPEN,
            selections: {
              create: dto.selections.map(({ key, odds }) => {
                const label = marketOutcomes(dto.type).find(
                  (outcome) => outcome.key === key,
                )?.label;
                if (!label) throw validationError('La selección no corresponde a este mercado.');
                return { key, label, odds, source: OddsSource.MANUAL };
              }),
            },
          },
          include: { selections: true },
        });
        for (const selection of market.selections) {
          await tx.oddsHistory.create({
            data: {
              selectionId: selection.id,
              source: OddsSource.MANUAL,
              previousOdds: null,
              newOdds: selection.odds,
              changedById: actorId,
            },
          });
        }
        await this.audit.record(
          {
            actorId,
            action: 'match.market.created',
            targetType: 'market',
            targetId: market.id,
            metadata: { matchId, type, line: dto.line ?? '' },
            ...meta,
          },
          tx,
        );
        return market;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('Ya existe un mercado de ese tipo y línea para el partido.');
      }
      throw error;
    }
  }

  async changeMarketStatus(
    actorId: string,
    id: string,
    status: PublicMarketStatus,
    meta: RequestMeta,
  ) {
    const next = this.marketStatusToDatabase(status);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.market.findUnique({
        where: { id },
        include: { match: { select: { status: true } } },
      });
      if (!current) throw notFound('No encontramos ese mercado.');
      if (next === MarketStatus.OPEN && !isLiveEligible(current.match.status)) {
        throw conflict('No se puede abrir un mercado de un partido suspendido o terminado.');
      }
      if (current.status === next) return current;
      const market = await tx.market.update({ where: { id }, data: { status: next } });
      await this.audit.record(
        {
          actorId,
          action: 'match.market.status.changed',
          targetType: 'market',
          targetId: id,
          metadata: { from: current.status, to: next },
          ...meta,
        },
        tx,
      );
      return market;
    });
  }

  async setManualOdds(actorId: string, marketId: string, dto: SetOddsDto, meta: RequestMeta) {
    try {
      assertDecimalOdds(dto.odds);
    } catch (error) {
      if (error instanceof MarketRuleError) throw validationError(error.message);
      throw error;
    }
    return this.prisma.$transaction(async (tx) => {
      const market = await tx.market.findUnique({
        where: { id: marketId },
        include: { match: { select: { status: true } } },
      });
      if (!market) throw notFound('No encontramos ese mercado.');
      if (market.status !== MarketStatus.OPEN || !isLiveEligible(market.match.status)) {
        throw conflict('No se pueden cambiar cuotas de un mercado no disponible.');
      }
      const outcome = marketOutcomes(marketTypeToPublic[market.type]).find(
        ({ key }) => key === dto.key,
      );
      if (!outcome) throw validationError('La selección no corresponde a este mercado.');

      const current = await tx.selection.findUnique({
        where: {
          marketId_key_source: {
            marketId,
            key: dto.key,
            source: OddsSource.MANUAL,
          },
        },
      });
      if (current?.odds.toFixed(3) === Number(dto.odds).toFixed(3)) {
        return { key: current.key, odds: current.odds.toFixed(3), source: PublicOddsSource.MANUAL };
      }
      const selection = current
        ? await tx.selection.update({
            where: { id: current.id },
            data: { odds: dto.odds, label: outcome.label, isActive: true },
          })
        : await tx.selection.create({
            data: {
              marketId,
              key: dto.key,
              label: outcome.label,
              odds: dto.odds,
              source: OddsSource.MANUAL,
            },
          });
      await tx.oddsHistory.create({
        data: {
          selectionId: selection.id,
          source: OddsSource.MANUAL,
          previousOdds: current?.odds ?? null,
          newOdds: selection.odds,
          changedById: actorId,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'match.odds.manual.changed',
          targetType: 'selection',
          targetId: selection.id,
          metadata: {
            marketId,
            key: dto.key,
            from: current?.odds.toFixed(3) ?? '',
            to: selection.odds.toFixed(3),
          },
          ...meta,
        },
        tx,
      );
      return {
        key: selection.key,
        odds: selection.odds.toFixed(3),
        source: PublicOddsSource.MANUAL,
      };
    });
  }

  private serializeMatch(match: MatchRecord, includeExternalOdds: boolean): MatchSummary {
    return {
      id: match.id,
      kickoffAt: match.kickoffAt.toISOString(),
      status: matchStatusToPublic[match.status],
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      competition: match.competition,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      markets: match.markets.map((market) => {
        const activeSelections = market.selections.filter((selection) => selection.isActive);
        const selections = includeExternalOdds
          ? activeSelections
          : [
              ...activeSelections
                .reduce((chosen, selection) => {
                  const current = chosen.get(selection.key);
                  if (!current || selection.source === OddsSource.MANUAL) {
                    chosen.set(selection.key, selection);
                  }
                  return chosen;
                }, new Map<string, (typeof activeSelections)[number]>())
                .values(),
            ];
        return {
          id: market.id,
          type: marketTypeToPublic[market.type],
          line: market.type === MarketType.TOTAL_GOALS ? (market.line?.toFixed(2) ?? null) : null,
          status: marketStatusToPublic[market.status],
          selections: selections.map((selection) => ({
            id: selection.id,
            key: selection.key,
            label: selection.label,
            odds: selection.odds.toFixed(3),
            source: oddsSourceToPublic[selection.source],
            isActive: selection.isActive,
            updatedAt: selection.updatedAt.toISOString(),
          })),
        };
      }),
    };
  }

  private normalizeTeamName(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase()
      .trim();
  }

  private async getOrCreateManualTeams(names: string[], tx: Transaction) {
    const orderedNames = [...new Set(names)].sort((a, b) =>
      this.normalizeTeamName(a).localeCompare(this.normalizeTeamName(b)),
    );
    for (const name of orderedNames) {
      await tx.$queryRaw<{ locked: boolean }[]>`
        WITH lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${this.normalizeTeamName(name)}))
        )
        SELECT TRUE AS locked FROM lock`;
    }

    const teams = new Map<
      string,
      NonNullable<Awaited<ReturnType<Transaction['team']['findFirst']>>>
    >();
    for (const name of orderedNames) {
      const existing = await tx.team.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
      });
      const team = existing ?? (await tx.team.create({ data: { name } }));
      teams.set(this.normalizeTeamName(name), team);
    }
    return teams;
  }

  private async lockMatch(id: string, tx: Transaction) {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Match" WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows[0]) throw notFound('No encontramos ese partido.');
    return tx.match.findUniqueOrThrow({ where: { id } });
  }

  private assertTransition(current: MatchStatus, next: MatchStatus, role: Role, reason?: string) {
    try {
      assertMatchTransition(matchStatusToPublic[current], matchStatusToPublic[next], role, reason);
    } catch (error) {
      if (error instanceof MatchRuleError) throw conflict(error.message);
      throw error;
    }
  }

  private assertScore(homeScore: number, awayScore: number) {
    try {
      assertValidScore(homeScore, awayScore);
    } catch (error) {
      if (error instanceof MatchRuleError) throw validationError(error.message);
      throw error;
    }
  }

  private marketStatusToDatabase(status: PublicMarketStatus): MarketStatus {
    switch (status) {
      case PublicMarketStatus.OPEN:
        return MarketStatus.OPEN;
      case PublicMarketStatus.SUSPENDED:
        return MarketStatus.SUSPENDED;
      case PublicMarketStatus.CLOSED:
        return MarketStatus.CLOSED;
    }
  }

  private validateDateRange(filters: MatchFiltersDto): void {
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) {
      throw validationError('La fecha inicial debe ser anterior a la fecha final.');
    }
  }

  private publicWhere(
    filters: MatchFiltersDto,
    ignored?: 'competition' | 'status',
  ): Prisma.MatchWhereInput {
    const activeMarket: Prisma.MatchWhereInput = {
      markets: {
        some: {
          status: MarketStatus.OPEN,
          selections: { some: { isActive: true } },
        },
      },
    };
    const includeLiveWithoutOdds =
      ignored === 'status' || !filters.status || filters.status === PublicMatchStatus.LIVE;

    return {
      status:
        ignored === 'status' || !filters.status
          ? { in: [MatchStatus.SCHEDULED, MatchStatus.LIVE] }
          : matchStatusToDatabase[filters.status],
      competitionId: ignored === 'competition' ? undefined : filters.competitionId,
      kickoffAt: this.kickoffFilter(filters),
      AND: [
        includeLiveWithoutOdds
          ? { OR: [{ status: MatchStatus.LIVE }, activeMarket] }
          : activeMarket,
        ...(filters.from === undefined && filters.to === undefined
          ? [{ OR: [{ kickoffAt: { gte: new Date() } }, { status: MatchStatus.LIVE }] }]
          : []),
      ],
    };
  }

  private kickoffFilter(filters: MatchFiltersDto): Prisma.DateTimeFilter | undefined {
    if (!filters.from && !filters.to) return undefined;
    return {
      gte: filters.from ? new Date(filters.from) : undefined,
      lte: filters.to ? new Date(filters.to) : undefined,
    };
  }
}
