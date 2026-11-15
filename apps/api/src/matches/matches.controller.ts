import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { FootballSyncService } from './football-sync';
import {
  CreateCompetitionDto,
  CreateMarketDto,
  CreateMatchDto,
  MatchFiltersDto,
  MatchStatusDto,
  MarketStatusDto,
  SetOddsDto,
  UpdateCompetitionDto,
  UpdateMatchDto,
} from './matches.dto';
import { MatchesService } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Public()
  @Get('competitions')
  async listCompetitions(@Query() filters: MatchFiltersDto) {
    return (await this.matches.listPublicFilters(filters)).competitions;
  }

  @Public()
  @Get('filters')
  listFilters(@Query() filters: MatchFiltersDto) {
    return this.matches.listPublicFilters(filters);
  }

  @Public()
  @Get()
  list(@Query() filters: MatchFiltersDto) {
    return this.matches.listPublic(filters);
  }

  @Public()
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.getPublic(id);
  }
}

@Roles(Role.OPERATOR, Role.ADMIN)
@Controller('operator')
export class OperatorMatchesController {
  constructor(
    private readonly matches: MatchesService,
    private readonly footballSync: FootballSyncService,
  ) {}

  @Get('sync/status')
  syncStatus() {
    return this.footballSync.status();
  }

  @Get('competitions')
  listCompetitions() {
    return this.matches.listCompetitions();
  }

  @Post('competitions')
  createCompetition(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCompetitionDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.createCompetition(user.id, dto, meta);
  }

  @Patch('competitions/:id')
  updateCompetition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompetitionDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.updateCompetition(user.id, id, dto, meta);
  }

  @Get('matches')
  listMatches(@Query() filters: MatchFiltersDto) {
    return this.matches.listForOperator(filters);
  }

  @Get('matches/:id')
  getMatch(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.getForOperator(id);
  }

  @Post('matches')
  createMatch(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMatchDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.createMatch(user.id, dto, meta);
  }

  @Patch('matches/:id')
  updateMatch(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatchDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.updateMatch(user.id, id, dto, meta);
  }

  @Patch('matches/:id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MatchStatusDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.changeStatus(user.id, id, user.role, dto, meta);
  }

  @Post('matches/:id/markets')
  createMarket(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMarketDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.createMarket(user.id, id, dto, meta);
  }

  @Patch('markets/:id/status')
  changeMarketStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarketStatusDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.changeMarketStatus(user.id, id, dto.status, meta);
  }

  @Patch('markets/:id/odds')
  setOdds(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetOddsDto,
    @Meta() meta: RequestMeta,
  ) {
    return this.matches.setManualOdds(user.id, id, dto, meta);
  }
}
