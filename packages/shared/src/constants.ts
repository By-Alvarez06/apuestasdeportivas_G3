/**
 * Shared constants for the sports betting platform.
 */

/** Application version — keep in sync with root package.json. */
export const APP_VERSION = '0.1.0';

/** Default service ports for local development. */
export const PORTS = {
  WEB: 3000,
  API: 3001,
  REPORTS: 8000,
  POSTGRES: 5432,
  REDIS: 6379,
} as const;

/** Minimum bet amount in cents. */
export const MIN_BET_AMOUNT = 100;

/** Maximum bet amount in cents. */
export const MAX_BET_AMOUNT = 1_000_000;

/** Suspension grace period in hours before voiding bets. */
export const SUSPENSION_GRACE_HOURS = 48;
