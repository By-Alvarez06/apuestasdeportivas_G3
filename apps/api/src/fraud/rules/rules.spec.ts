import { anomalousStake } from './anomalous-stake';
import { mirrorBets } from './mirror-bets';
import { multiAccount } from './multi-account';
import { oddsDropPattern } from './odds-drop-pattern';
import { resettlementDebt } from './resettlement-debt';
import { withdrawalNoActivity } from './withdrawal-no-activity';

const MIN = 60_000;
const t0 = new Date('2026-11-14T12:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * MIN);

describe('reglas de fraude (T062)', () => {
  describe('MULTI_ACCOUNT', () => {
    const group = (n: number) => ({
      kind: 'device' as const,
      key: 'abc',
      userIds: Array.from({ length: n }, (_, i) => `u${i}`),
    });

    it('alerta con el mínimo de cuentas que comparten la señal', () => {
      expect(multiAccount([group(3)], 3)).toEqual([
        {
          rule: 'MULTI_ACCOUNT',
          severity: 'HIGH',
          subjectKey: 'device:abc',
          userIds: ['u0', 'u1', 'u2'],
          evidence: { kind: 'device', accounts: 3 },
        },
      ]);
    });

    it('no alerta justo por debajo del mínimo', () => {
      expect(multiAccount([group(2)], 3)).toEqual([]);
    });

    it('compartir IP es una señal débil (redes compartidas): alerta media, no bloquea cupones', () => {
      const [alert] = multiAccount([{ kind: 'ip', key: '10.0.0.1', userIds: ['a', 'b', 'c'] }], 3);
      expect(alert).toMatchObject({ severity: 'MEDIUM', subjectKey: 'ip:10.0.0.1' });
    });

    it('cuenta cada cuenta una sola vez', () => {
      expect(multiAccount([{ kind: 'payer', key: 'x', userIds: ['a', 'a', 'b'] }], 3)).toEqual([]);
    });
  });

  describe('ANOMALOUS_STAKE', () => {
    const base = { userId: 'u', betId: 'b', factor: 5, minStake: 5000 };

    it('alerta si supera varias veces el promedio y el mínimo', () => {
      const alert = anomalousStake({ ...base, stake: 6000, history: [1000, 1000, 1000] });
      expect(alert).toMatchObject({
        rule: 'ANOMALOUS_STAKE',
        severity: 'MEDIUM',
        subjectKey: 'user:u',
        userIds: ['u'],
        evidence: { stake: 6000, average: 1000, betId: 'b' },
      });
    });

    it('no alerta justo en el límite del factor', () => {
      expect(anomalousStake({ ...base, stake: 5000, history: [1000, 1000, 1000] })).toBeNull();
    });

    it('no alerta con montos pequeños aunque superen el factor', () => {
      expect(anomalousStake({ ...base, stake: 4000, history: [100, 100, 100] })).toBeNull();
    });

    it('necesita al menos 3 apuestas previas para comparar', () => {
      expect(anomalousStake({ ...base, stake: 60_000, history: [100, 100] })).toBeNull();
    });
  });

  describe('ODDS_DROP_PATTERN', () => {
    const params = { userId: 'u', dropPct: 15, windowMinutes: 10, minBets: 3 };
    const bet = (odds: number, after: number[]) => ({
      betId: `b${odds}`,
      selectionId: 's',
      odds,
      placedAt: t0,
      history: after.map((o, i) => ({ at: at(i + 1), odds: o })),
    });

    it('alerta si varias apuestas fueron seguidas de una caída fuerte de la cuota', () => {
      const alert = oddsDropPattern({
        ...params,
        bets: [bet(200, [170]), bet(300, [250]), bet(400, [300])],
      });
      expect(alert).toMatchObject({
        rule: 'ODDS_DROP_PATTERN',
        severity: 'MEDIUM',
        subjectKey: 'user:u',
        evidence: { bets: 3 },
      });
    });

    it('no cuenta caídas menores al porcentaje ni fuera de la ventana', () => {
      const late = {
        ...bet(200, []),
        history: [{ at: at(11), odds: 100 }],
      };
      expect(
        oddsDropPattern({ ...params, bets: [bet(200, [171]), bet(300, [260]), late] }),
      ).toBeNull();
    });

    it('no alerta por debajo del mínimo de apuestas', () => {
      expect(oddsDropPattern({ ...params, bets: [bet(200, [100]), bet(300, [100])] })).toBeNull();
    });
  });

  describe('MIRROR_BETS', () => {
    const params = { windowMinutes: 5, related: new Set(['a', 'b']) };

    it('alerta si cuentas relacionadas apuestan la misma selección en la ventana', () => {
      const alert = mirrorBets({
        ...params,
        bet: { userId: 'a', selectionId: 's1', placedAt: at(0) },
        others: [{ userId: 'b', selectionId: 's1', placedAt: at(-3) }],
      });
      expect(alert).toMatchObject({
        rule: 'MIRROR_BETS',
        severity: 'HIGH',
        subjectKey: 'mirror:s1:b',
        userIds: ['a', 'b'],
      });
    });

    it('no alerta fuera de la ventana, con otra selección o con cuentas no relacionadas', () => {
      const bet = { userId: 'a', selectionId: 's1', placedAt: at(0) };
      expect(
        mirrorBets({
          ...params,
          bet,
          others: [{ userId: 'b', selectionId: 's1', placedAt: at(-6) }],
        }),
      ).toBeNull();
      expect(
        mirrorBets({
          ...params,
          bet,
          others: [{ userId: 'b', selectionId: 's2', placedAt: at(-1) }],
        }),
      ).toBeNull();
      expect(
        mirrorBets({
          ...params,
          bet,
          others: [{ userId: 'c', selectionId: 's1', placedAt: at(-1) }],
        }),
      ).toBeNull();
    });
  });

  describe('WITHDRAWAL_NO_ACTIVITY', () => {
    it('alerta si se retira tras un depósito sin apostar en medio', () => {
      expect(
        withdrawalNoActivity({ userId: 'u', withdrawalId: 'w', depositId: 'd', betsBetween: 0 }),
      ).toMatchObject({
        rule: 'WITHDRAWAL_NO_ACTIVITY',
        severity: 'MEDIUM',
        subjectKey: 'withdrawal:w',
      });
    });

    it('no alerta si apostó entre el depósito y el retiro', () => {
      expect(
        withdrawalNoActivity({ userId: 'u', withdrawalId: 'w', depositId: 'd', betsBetween: 1 }),
      ).toBeNull();
    });
  });

  describe('RESETTLEMENT_DEBT', () => {
    it('alerta alta por toda deuda nacida de una re-liquidación', () => {
      expect(
        resettlementDebt({ userId: 'u', debtId: 'd', amount: 2000, betId: 'b' }),
      ).toMatchObject({
        rule: 'RESETTLEMENT_DEBT',
        severity: 'HIGH',
        subjectKey: 'debt:d',
        evidence: { amount: 2000, betId: 'b' },
      });
    });
  });
});
