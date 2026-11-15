import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/auth/decorators';
import { Role } from '../generated/prisma/enums';
import { ReportExportDto, ReportFiltersDto } from './reports.dto';
import { ReportsService } from './reports.service';

@Roles(Role.OPERATOR, Role.ADMIN)
@Controller('operator/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  dashboard(@Query() filters: ReportFiltersDto) {
    return this.reports.dashboard(filters);
  }

  @Get('export')
  export(@Query() filters: ReportExportDto) {
    return this.reports.export(filters);
  }
}
