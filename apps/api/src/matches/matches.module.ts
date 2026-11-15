import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MatchesController, OperatorMatchesController } from './matches.controller';
import { ApiFootballClient } from './api-football.client';
import { FootballBudgetService } from './football-budget';
import { FootballSyncService } from './football-sync';
import { MatchesService } from './matches.service';

@Module({
  imports: [AuditModule],
  controllers: [MatchesController, OperatorMatchesController],
  providers: [MatchesService, FootballBudgetService, ApiFootballClient, FootballSyncService],
  exports: [MatchesService],
})
export class MatchesModule {}
