import { adaptiveInterval } from './football-sync';

describe('frecuencia adaptativa de API-Football', () => {
  const liveInterval = 60_000;
  const scheduledInterval = 1_800_000;
  const remainingTime = 12 * 60 * 60 * 1000;

  it('prioritizes live matches while respecting the minimum interval', () => {
    expect(adaptiveInterval(3, 500, remainingTime, liveInterval, scheduledInterval)).toBe(
      remainingTime / 500,
    );
    expect(adaptiveInterval(0, 500, remainingTime, liveInterval, scheduledInterval)).toBe(
      scheduledInterval,
    );
  });

  it('stretches polling to spread a small budget across the day', () => {
    expect(adaptiveInterval(1, 10, remainingTime, liveInterval, scheduledInterval)).toBe(
      remainingTime / 10,
    );
    expect(adaptiveInterval(0, 2, remainingTime, liveInterval, scheduledInterval)).toBe(
      remainingTime / 2,
    );
  });

  it('waits until the daily reset when no requests remain', () => {
    expect(adaptiveInterval(1, 0, remainingTime, liveInterval, scheduledInterval)).toBe(
      remainingTime,
    );
  });
});
