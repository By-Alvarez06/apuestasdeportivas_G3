import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MatchesController, OperatorMatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

@Module({
  imports: [AuditModule],
  controllers: [MatchesController, OperatorMatchesController],
  providers: [MatchesService],
  exports: [MatchesService],
})
export class MatchesModule {}
