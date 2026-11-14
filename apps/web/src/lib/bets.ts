/** Formas de la API de apuestas (specs/004-apuestas-liquidacion/contracts/http-api.md). */

export interface CatalogSelection {
  selectionId: string;
  label: string;
  odds: string;
}

export interface CatalogMarket {
  marketId: string;
  label: string;
  status: 'OPEN' | 'SUSPENDED' | 'CLOSED' | 'RESULTED' | 'VOID';
  live: boolean;
  selections: CatalogSelection[];
}

export interface CatalogMatch {
  matchId: string;
  label: string;
  startsAt: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'SUSPENDED' | 'POSTPONED' | 'CANCELLED';
  markets: CatalogMarket[];
}

export interface BetSelectionView {
  id: string;
  selectionId: string;
  matchLabel: string;
  marketLabel: string;
  selectionLabel: string;
  odds: string;
  status: 'PENDING' | 'WON' | 'LOST' | 'VOID';
  startsAt: string;
}

export interface BetView {
  id: string;
  type: 'SINGLE' | 'COMBO';
  status: 'OPEN' | 'WON' | 'LOST' | 'VOID';
  stake: string;
  source: 'REAL' | 'BONUS' | 'FREE_BET';
  totalOdds: string;
  potentialPayout: string;
  payout: string;
  live: boolean;
  acceptedAt: string;
  settledAt: string | null;
  selections: BetSelectionView[];
}

export interface BetsPage {
  items: BetView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BettingLimits {
  minStake: string;
  maxStake: string;
  maxPayout: string;
  dailyStakePerUser: string;
  dailyStakeUsed: string;
  comboMaxSelections: number;
}

/** Selección elegida en el boleto, con la cuota que el apostador está viendo. */
export interface SlipSelection {
  selectionId: string;
  matchId: string;
  matchLabel: string;
  marketLabel: string;
  selectionLabel: string;
  odds: string;
  live: boolean;
}

export const BET_STATUS_LABEL: Record<BetView['status'], string> = {
  OPEN: 'En juego',
  WON: 'Ganada',
  LOST: 'Perdida',
  VOID: 'Reembolsada',
};

export const SELECTION_STATUS_LABEL: Record<BetSelectionView['status'], string> = {
  PENDING: 'Pendiente',
  WON: 'Acertada',
  LOST: 'Fallada',
  VOID: 'Anulada',
};

/** "Liga Pro · Barcelona SC vs Emelec" → competición y equipos por separado. */
export function splitMatchLabel(label: string): { competition: string; teams: string } {
  const at = label.indexOf(' · ');
  return at === -1
    ? { competition: '', teams: label }
    : { competition: label.slice(0, at), teams: label.slice(at + 3) };
}
