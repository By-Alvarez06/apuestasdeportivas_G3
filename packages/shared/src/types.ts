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

/** User roles in the platform (RBAC). */
export enum UserRole {
  BETTOR = 'bettor',
  OPERATOR = 'operator',
  ADMIN = 'admin',
}

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
