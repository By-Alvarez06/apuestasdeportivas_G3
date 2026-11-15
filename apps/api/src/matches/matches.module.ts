import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QueuesModule } from '../queues/queues.module';
import { MatchesController, OperatorMatchesController } from './matches.controller';
import { ApiFootballClient } from './api-football.client';
import { FootballBudgetService } from './football-budget';
import { MatchEventPublisher } from './match-event.publisher';
import { FootballSyncService } from './football-sync';
import { MatchesService } from './matches.service';

@Module({
  imports: [AuditModule, QueuesModule],
  controllers: [MatchesController, OperatorMatchesController],
  providers: [
    MatchesService,
    MatchEventPublisher,
    FootballBudgetService,
    ApiFootballClient,
    FootballSyncService,
  ],
  exports: [MatchesService],
})
export class MatchesModule {}
