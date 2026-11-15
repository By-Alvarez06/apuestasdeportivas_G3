import { MarketType } from '@apuestas/shared';

const outcomes: Record<MarketType, readonly { key: string; label: string }[]> = {
  [MarketType.RESULT_1X2]: [
    { key: 'HOME', label: 'Local' },
    { key: 'DRAW', label: 'Empate' },
    { key: 'AWAY', label: 'Visitante' },
  ],
  [MarketType.DOUBLE_CHANCE]: [
    { key: 'HOME_OR_DRAW', label: 'Local o empate' },
    { key: 'HOME_OR_AWAY', label: 'Local o visitante' },
    { key: 'DRAW_OR_AWAY', label: 'Empate o visitante' },
  ],
  [MarketType.TOTAL_GOALS]: [
    { key: 'OVER', label: 'Más' },
    { key: 'UNDER', label: 'Menos' },
  ],
  [MarketType.BOTH_TEAMS_SCORE]: [
    { key: 'YES', label: 'Sí' },
    { key: 'NO', label: 'No' },
  ],
};

export class MarketRuleError extends Error {}

export function marketOutcomes(type: MarketType) {
  return outcomes[type];
}

export type MarketSelectionResult = 'WON' | 'LOST' | 'VOID';

export function resolveMarketOutcomes(
  type: MarketType,
  line: number | null,
  homeScore: number,
  awayScore: number,
  selectionKeys: { id: string; key: string }[],
): Record<string, MarketSelectionResult> {
  const total = homeScore + awayScore;
  const homeWon = homeScore > awayScore;
  const draw = homeScore === awayScore;
  const known: Record<string, MarketSelectionResult> =
    type === MarketType.RESULT_1X2
      ? {
          HOME: homeWon ? 'WON' : 'LOST',
          DRAW: draw ? 'WON' : 'LOST',
          AWAY: !homeWon && !draw ? 'WON' : 'LOST',
        }
      : type === MarketType.DOUBLE_CHANCE
        ? {
            HOME_OR_DRAW: homeWon || draw ? 'WON' : 'LOST',
            HOME_OR_AWAY: draw ? 'LOST' : 'WON',
            DRAW_OR_AWAY: !homeWon ? 'WON' : 'LOST',
          }
        : type === MarketType.TOTAL_GOALS
          ? {
              OVER: line === null || total === line ? 'VOID' : total > line ? 'WON' : 'LOST',
              UNDER: line === null || total === line ? 'VOID' : total < line ? 'WON' : 'LOST',
            }
          : {
              YES: homeScore > 0 && awayScore > 0 ? 'WON' : 'LOST',
              NO: homeScore === 0 || awayScore === 0 ? 'WON' : 'LOST',
            };

  return Object.fromEntries(selectionKeys.map(({ id, key }) => [id, known[key] ?? 'VOID']));
}

export function assertMarketOutcomes(type: MarketType, keys: string[]): void {
  const expected = outcomes[type].map(({ key }) => key).sort();
  const actual = [...keys].sort();
  if (new Set(actual).size !== actual.length || actual.join(',') !== expected.join(',')) {
    throw new MarketRuleError(
      `El mercado ${type} requiere las selecciones: ${expected.join(', ')}.`,
    );
  }
}

export function assertMarketLine(type: MarketType, line?: string): void {
  if (type === MarketType.TOTAL_GOALS) {
    if (!line || !/^\d{1,3}(?:\.\d{1,2})?$/.test(line) || Number(line) <= 0) {
      throw new MarketRuleError('El mercado de total de goles requiere una línea positiva.');
    }
    return;
  }
  if (line !== undefined) throw new MarketRuleError('Este tipo de mercado no acepta una línea.');
}

export function assertDecimalOdds(value: string): void {
  if (!/^\d{1,5}(?:\.\d{1,3})?$/.test(value) || Number(value) <= 1) {
    throw new MarketRuleError(
      'La cuota decimal debe ser mayor que 1 y tener hasta tres decimales.',
    );
  }
}
