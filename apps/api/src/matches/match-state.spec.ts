import { MatchStatus } from '@apuestas/shared';
import { Role } from '../generated/prisma/enums';
import { assertMatchTransition, assertValidScore, MatchRuleError } from './match-state';

describe('match state machine', () => {
  const transitions: [MatchStatus, MatchStatus][] = [
    [MatchStatus.SCHEDULED, MatchStatus.LIVE],
    [MatchStatus.SCHEDULED, MatchStatus.SUSPENDED],
    [MatchStatus.SCHEDULED, MatchStatus.POSTPONED],
    [MatchStatus.SCHEDULED, MatchStatus.CANCELLED],
    [MatchStatus.LIVE, MatchStatus.SUSPENDED],
    [MatchStatus.LIVE, MatchStatus.POSTPONED],
    [MatchStatus.LIVE, MatchStatus.FINISHED],
    [MatchStatus.LIVE, MatchStatus.CANCELLED],
    [MatchStatus.SUSPENDED, MatchStatus.LIVE],
    [MatchStatus.SUSPENDED, MatchStatus.POSTPONED],
    [MatchStatus.SUSPENDED, MatchStatus.FINISHED],
    [MatchStatus.SUSPENDED, MatchStatus.CANCELLED],
    [MatchStatus.POSTPONED, MatchStatus.SCHEDULED],
    [MatchStatus.POSTPONED, MatchStatus.CANCELLED],
  ];

  it.each(transitions)('allows %s -> %s for an operator', (from, to) => {
    expect(() => assertMatchTransition(from, to, Role.OPERATOR)).not.toThrow();
  });

  it.each([
    [MatchStatus.FINISHED, MatchStatus.LIVE],
    [MatchStatus.CANCELLED, MatchStatus.SCHEDULED],
  ])('does not allow terminal correction %s -> %s for an operator', (from, to) => {
    expect(() => assertMatchTransition(from, to, Role.OPERATOR, 'Correction')).toThrow(
      MatchRuleError,
    );
  });

  it('allows an administrator to correct a terminal state only with a reason', () => {
    expect(() =>
      assertMatchTransition(
        MatchStatus.FINISHED,
        MatchStatus.LIVE,
        Role.ADMIN,
        'Official correction',
      ),
    ).not.toThrow();

    expect(() =>
      assertMatchTransition(MatchStatus.CANCELLED, MatchStatus.SCHEDULED, Role.ADMIN),
    ).toThrow(MatchRuleError);
  });

  it('rejects undefined transitions and no-op transitions', () => {
    expect(() =>
      assertMatchTransition(MatchStatus.SCHEDULED, MatchStatus.FINISHED, Role.OPERATOR),
    ).toThrow(MatchRuleError);
    expect(() => assertMatchTransition(MatchStatus.LIVE, MatchStatus.LIVE, Role.OPERATOR)).toThrow(
      MatchRuleError,
    );
  });

  it('accepts only non-negative integer scores', () => {
    expect(() => assertValidScore(0, 0)).not.toThrow();
    expect(() => assertValidScore(2, 1)).not.toThrow();

    for (const [home, away] of [
      [-1, 0],
      [0, -1],
      [1.5, 0],
      [0, Number.NaN],
    ]) {
      expect(() => assertValidScore(home, away)).toThrow(MatchRuleError);
    }
  });
});
