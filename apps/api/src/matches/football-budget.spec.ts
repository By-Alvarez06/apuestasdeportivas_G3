import { ConfigService } from '@nestjs/config';
import { configuredDailyLimit } from './football-budget';

describe('API-Football daily budget configuration', () => {
  it('fails closed when the key or a positive daily budget is missing', async () => {
    expect(configuredDailyLimit(new ConfigService({}))).toBeNull();
    expect(configuredDailyLimit(new ConfigService({ API_FOOTBALL_DAILY_BUDGET: '0' }))).toBeNull();
    expect(
      configuredDailyLimit(new ConfigService({ API_FOOTBALL_DAILY_BUDGET: '1.5' })),
    ).toBeNull();
  });
});
