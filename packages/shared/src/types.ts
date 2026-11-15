/**
 * Shared type definitions for the sports betting platform.
 */

/** Health check response returned by all services. */
export interface HealthCheckResponse {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
  version: string;
  uptime?: number;
}

/** User roles in the platform (RBAC). Mismos valores que el enum `Role` de la base de datos. */
export enum UserRole {
  BETTOR = 'BETTOR',
  OPERATOR = 'OPERATOR',
  ADMIN = 'ADMIN',
}

export enum UserStatus {
  UNVERIFIED = 'UNVERIFIED',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum DepositStatus {
  PENDING = 'PENDING',
  CREDITED = 'CREDITED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  IN_REVIEW = 'IN_REVIEW',
}

export enum WithdrawalStatus {
  PROCESSING = 'PROCESSING',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
}

/** Códigos de error de la API (specs/002-cuentas-billetera/contracts/http-api.md). */
export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  CONFLICT = 'CONFLICT',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  // Spec 4 (specs/004-apuestas-liquidacion/contracts/http-api.md)
  ODDS_CHANGED = 'ODDS_CHANGED',
  MARKET_CLOSED = 'MARKET_CLOSED',
  MATCH_STARTED = 'MATCH_STARTED',
  STAKE_OUT_OF_LIMITS = 'STAKE_OUT_OF_LIMITS',
  PAYOUT_LIMIT = 'PAYOUT_LIMIT',
  DAILY_LIMIT = 'DAILY_LIMIT',
  DEBT_OUTSTANDING = 'DEBT_OUTSTANDING',
  COUPON_INVALID = 'COUPON_INVALID',
  COUPON_ALREADY_USED = 'COUPON_ALREADY_USED',
  COUPON_BLOCKED = 'COUPON_BLOCKED',
  BONUS_ACTIVE = 'BONUS_ACTIVE',
}

/** Forma de todas las respuestas de error de la API. `details` solo en los errores que lo documentan. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

/** Monto en la frontera de la API: string con 2 decimales, p. ej. "20.00". */
export type Money = string;

/** Match status state machine. */
export enum MatchStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  FINISHED = 'finished',
  SUSPENDED = 'suspended',
  POSTPONED = 'postponed',
  CANCELLED = 'cancelled',
}

/** Cuota en la frontera de la API: string con 2 decimales, p. ej. "2.10" (internamente, centésimas). */
export type Odds = string;

// ── Apuestas (spec 4) ── mismos valores que los enums de la base de datos.

export enum BetType {
  SINGLE = 'SINGLE',
  COMBO = 'COMBO',
}

/** Saldo con el que se paga una apuesta. */
export enum StakeSource {
  REAL = 'REAL',
  BONUS = 'BONUS',
  FREE_BET = 'FREE_BET',
}

/** Ciclo de vida de una apuesta: OPEN hasta liquidarse; VOID = reembolsada. */
export enum MarketType {
  RESULT_1X2 = 'result_1x2',
  DOUBLE_CHANCE = 'double_chance',
  TOTAL_GOALS = 'total_goals',
  BOTH_TEAMS_SCORE = 'both_teams_score',
}

export enum MarketStatus {
  OPEN = 'open',
  SUSPENDED = 'suspended',
  CLOSED = 'closed',
}

export enum OddsSource {
  MANUAL = 'MANUAL',
  API_FOOTBALL = 'API_FOOTBALL',
}

export interface MatchSelection {
  id: string;
  key: string;
  label: string;
  odds: string;
  source: OddsSource;
  isActive: boolean;
  updatedAt: string;
}

export interface MatchMarket {
  id: string;
  type: MarketType;
  line: string | null;
  status: MarketStatus;
  selections: MatchSelection[];
}

export interface MatchSummary {
  id: string;
  kickoffAt: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  competition: { id: string; name: string; country: string | null } | null;
  homeTeam: { id: string; name: string; logoUrl: string | null };
  awayTeam: { id: string; name: string; logoUrl: string | null };
  markets: MatchMarket[];
}

/** Bet status lifecycle. */
export enum BetStatus {
  OPEN = 'OPEN',
  WON = 'WON',
  LOST = 'LOST',
  VOID = 'VOID',
}

export enum SelectionStatus {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  VOID = 'VOID',
}

export enum CouponType {
  DEPOSIT_BONUS = 'DEPOSIT_BONUS',
  FREE_BET = 'FREE_BET',
  ODDS_BOOST = 'ODDS_BOOST',
}

export enum RedemptionStatus {
  AWAITING_DEPOSIT = 'AWAITING_DEPOSIT',
  GRANTED = 'GRANTED',
  AVAILABLE = 'AVAILABLE',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
}

export enum BonusStatus {
  ACTIVE = 'ACTIVE',
  CONVERTED = 'CONVERTED',
  EXPIRED = 'EXPIRED',
}

export enum FraudRule {
  MULTI_ACCOUNT = 'MULTI_ACCOUNT',
  ANOMALOUS_STAKE = 'ANOMALOUS_STAKE',
  ODDS_DROP_PATTERN = 'ODDS_DROP_PATTERN',
  MIRROR_BETS = 'MIRROR_BETS',
  WITHDRAWAL_NO_ACTIVITY = 'WITHDRAWAL_NO_ACTIVITY',
  RESETTLEMENT_DEBT = 'RESETTLEMENT_DEBT',
}

export enum AlertStatus {
  OPEN = 'OPEN',
  DISMISSED = 'DISMISSED',
  CONFIRMED = 'CONFIRMED',
}

/** Supported currencies (sandbox only). */
export type Currency = 'USD';
