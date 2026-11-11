import { NextResponse } from 'next/server';
import { APP_VERSION } from '@apuestas/shared';
import type { HealthCheckResponse } from '@apuestas/shared';

export async function GET() {
  const response: HealthCheckResponse = {
    status: 'ok',
    service: 'web',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
  };
  return NextResponse.json(response);
}
