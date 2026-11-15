import type { AlertDraft } from './types';

/** Cuentas que comparten una señal de identidad. */
export interface SharedSignal {
  /** device = cookie device_id; payer = titular de pago; ip = IP de sesión. */
  kind: 'device' | 'payer' | 'ip';
  key: string;
  userIds: string[];
}

/**
 * MULTI_ACCOUNT: `min` o más cuentas distintas comparten dispositivo, titular de pago o IP
 * (FR-034). Dispositivo y titular son señales fuertes: alerta alta, que bloquea el canje de
 * cupones (FR-037). La IP se comparte legítimamente (NAT, redes de universidades): alerta media.
 */
export function multiAccount(signals: readonly SharedSignal[], min: number): AlertDraft[] {
  return signals.flatMap((s) => {
    const userIds = [...new Set(s.userIds)].sort();
    if (userIds.length < min) return [];
    return [
      {
        rule: 'MULTI_ACCOUNT' as const,
        severity: s.kind === 'ip' ? ('MEDIUM' as const) : ('HIGH' as const),
        subjectKey: `${s.kind}:${s.key}`,
        userIds,
        evidence: { kind: s.kind, accounts: userIds.length },
      },
    ];
  });
}
