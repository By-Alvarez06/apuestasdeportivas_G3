import { MarketType } from '@apuestas/shared';
import {
  assertDecimalOdds,
  assertMarketLine,
  assertMarketOutcomes,
  MarketRuleError,
  marketOutcomes,
} from './market-outcomes';

describe('market definitions', () => {
  it.each(Object.values(MarketType))('requires the complete selection set for %s', (type) => {
    const keys = marketOutcomes(type).map(({ key }) => key);
    expect(() => assertMarketOutcomes(type, keys)).not.toThrow();
    expect(() => assertMarketOutcomes(type, keys.slice(1))).toThrow(MarketRuleError);
    expect(() => assertMarketOutcomes(type, [...keys, keys[0] ?? 'UNKNOWN'])).toThrow(
      MarketRuleError,
    );
  });

  it('requires a positive line only for total-goals markets', () => {
    expect(() => assertMarketLine(MarketType.TOTAL_GOALS, '2.5')).not.toThrow();
    expect(() => assertMarketLine(MarketType.TOTAL_GOALS)).toThrow(MarketRuleError);
    expect(() => assertMarketLine(MarketType.TOTAL_GOALS, '0')).toThrow(MarketRuleError);
    expect(() => assertMarketLine(MarketType.RESULT_1X2, '2.5')).toThrow(MarketRuleError);
    expect(() => assertMarketLine(MarketType.RESULT_1X2)).not.toThrow();
  });

  it('accepts valid decimal odds greater than one only', () => {
    for (const odds of ['1.01', '2', '99999.999']) {
      expect(() => assertDecimalOdds(odds)).not.toThrow();
    }
    for (const odds of ['1', '0.5', '100000', '2.1234', 'NaN']) {
      expect(() => assertDecimalOdds(odds)).toThrow(MarketRuleError);
    }
  });
});
