import { Controller, Get } from '@nestjs/common';
import { APP_VERSION } from '@apuestas/shared';
import type { HealthCheckResponse } from '@apuestas/shared';

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  @Get()
  check(): HealthCheckResponse {
    return {
      status: 'ok',
      service: 'api',
      timestamp: new Date().toISOString(),
      version: APP_VERSION,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
