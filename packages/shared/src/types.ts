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
}

/** Forma de todas las respuestas de error de la API. */
export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
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

/** Bet status lifecycle. */
export enum BetStatus {
  PENDING = 'pending',
  WON = 'won',
  LOST = 'lost',
  VOID = 'void',
  CASHOUT = 'cashout',
}

/** Supported currencies (sandbox only). */
export type Currency = 'USD';
