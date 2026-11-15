import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { PrismaService } from '../prisma/prisma.service';

interface SettingRule {
  default: number;
  min: number;
  max: number;
  description: string;
}

const HOUR = 3_600_000;

/**
 * Ajustes configurables de la spec 4 (research R12) con su valor inicial y rango válido.
 * Montos en centavos, cuotas en centésimas, tiempos en milisegundos salvo que se indique.
 */
export const SETTING_RULES = {
  'limits.minStake': {
    default: 50,
    min: 1,
    max: 1_000_000,
    description: 'Apuesta mínima (centavos)',
  },
  'limits.maxStake': {
    default: 50_000,
    min: 1,
    max: 10_000_000,
    description: 'Apuesta máxima (centavos)',
  },
  'limits.maxPayout': {
    default: 1_000_000,
    min: 1,
    max: 100_000_000,
    description: 'Ganancia máxima por apuesta (centavos)',
  },
  'limits.dailyStakePerUser': {
    default: 200_000,
    min: 1,
    max: 100_000_000,
    description: 'Monto apostado por usuario por día (centavos)',
  },
  'combo.maxSelections': {
    default: 10,
    min: 2,
    max: 20,
    description: 'Selecciones máximas en una combinada',
  },
  'live.delayMs': {
    default: 5000,
    min: 0,
    max: 60_000,
    description: 'Retardo de aceptación en vivo (ms)',
  },
  'suspension.windowMs': {
    default: 48 * HOUR,
    min: 1000,
    max: 30 * 24 * HOUR,
    description: 'Plazo para reanudar un partido suspendido o aplazado (ms)',
  },
  'bonus.rolloverMultiplier': {
    default: 5,
    min: 1,
    max: 50,
    description: 'Veces el bono que hay que apostar',
  },
  'bonus.minOdds': {
    default: 150,
    min: 101,
    max: 100_000,
    description: 'Cuota mínima que cuenta para el rollover (centésimas)',
  },
  'bonus.validDays': {
    default: 30,
    min: 1,
    max: 365,
    description: 'Días para cumplir el rollover',
  },
  'fraud.multiAccountMin': {
    default: 3,
    min: 2,
    max: 50,
    description: 'Cuentas que comparten dispositivo, IP o titular',
  },
  'fraud.multiAccountIpMin': {
    default: 10,
    min: 2,
    max: 1000,
    description: 'Cuentas que comparten IP de sesión en 7 días (redes compartidas: umbral alto)',
  },
  'fraud.anomalousStakeFactor': {
    default: 5,
    min: 2,
    max: 100,
    description: 'Veces el promedio histórico del usuario',
  },
  'fraud.anomalousStakeMin': {
    default: 5000,
    min: 1,
    max: 10_000_000,
    description: 'Monto mínimo para considerar una apuesta anómala (centavos)',
  },
  'fraud.oddsDropPct': {
    default: 15,
    min: 1,
    max: 90,
    description: 'Caída de cuota tras la apuesta (%)',
  },
  'fraud.oddsDropWindowMin': {
    default: 10,
    min: 1,
    max: 1440,
    description: 'Ventana para la caída de cuota (minutos)',
  },
  'fraud.oddsDropMinBets': {
    default: 3,
    min: 1,
    max: 100,
    description: 'Apuestas seguidas de caída de cuota en 30 días',
  },
  'fraud.mirrorWindowMin': {
    default: 5,
    min: 1,
    max: 1440,
    description: 'Ventana de apuestas espejo entre cuentas (minutos)',
  },
} as const satisfies Record<string, SettingRule>;

export type SettingKey = keyof typeof SETTING_RULES;
export type Settings = Record<SettingKey, number>;

export const SETTING_DEFAULTS = Object.fromEntries(
  Object.entries(SETTING_RULES).map(([key, rule]) => [key, rule.default]),
) as Settings;

const CACHE_MS = 10_000;

const isKey = (key: string): key is SettingKey => Object.hasOwn(SETTING_RULES, key);

function isValid(key: SettingKey, value: unknown): value is number {
  const rule: SettingRule = SETTING_RULES[key];
  return (
    Number.isSafeInteger(value) && (value as number) >= rule.min && (value as number) <= rule.max
  );
}

/**
 * Lee y cambia los ajustes de apuestas. Las lecturas se cachean 10 s; un cambio en esta instancia
 * aplica al instante. Solo operadores y administradores llegan a `set` (FR-039).
 */
@Injectable()
export class BettingSettingsService {
  private cache: { at: number; values: Settings } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Fuerza a releer de la base en la próxima lectura (pruebas, o tras cambios hechos por otra vía). */
  clearCache(): void {
    this.cache = null;
  }

  async get(key: SettingKey): Promise<number> {
    return (await this.getAll())[key];
  }

  async getAll(): Promise<Settings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return { ...this.cache.values };
    const rows = await this.prisma.bettingSetting.findMany();
    const values = { ...SETTING_DEFAULTS };
    for (const { key, value } of rows) if (isKey(key) && isValid(key, value)) values[key] = value;
    this.cache = { at: Date.now(), values };
    return { ...values };
  }

  async set(key: string, value: unknown, actorId: string, meta: RequestMeta): Promise<void> {
    if (!isKey(key)) throw validationError(`El ajuste "${key}" no existe.`);
    const rule: SettingRule = SETTING_RULES[key];
    if (!isValid(key, value))
      throw validationError(
        `${rule.description}: debe ser un número entero entre ${rule.min} y ${rule.max}.`,
      );

    const current = await this.getAll();
    const next = { ...current, [key]: value };
    if (next['limits.minStake'] >= next['limits.maxStake'])
      throw validationError('La apuesta mínima debe ser menor que la máxima.');

    await this.prisma.$transaction(async (tx) => {
      await tx.bettingSetting.upsert({
        where: { key },
        create: { key, value, updatedById: actorId },
        update: { value, updatedById: actorId },
      });
      await this.audit.record(
        {
          actorId,
          action: 'settings.changed',
          targetType: 'setting',
          targetId: key,
          metadata: { previous: current[key], value },
          ...meta,
        },
        tx,
      );
    });
    this.cache = { at: Date.now(), values: next };
  }
}
