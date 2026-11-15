import type { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import type { PrismaService } from '../prisma/prisma.service';
import { BettingSettingsService, SETTING_DEFAULTS } from './settings.service';

/** Prisma mínimo en memoria para BettingSetting. */
function fakePrisma() {
  const rows = new Map<string, unknown>();
  const reads = { count: 0 };
  const bettingSetting = {
    findMany: jest.fn(() => {
      reads.count++;
      return Promise.resolve([...rows].map(([key, value]) => ({ key, value })));
    }),
    upsert: jest.fn(({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
      rows.set(where.key, create.value);
      return Promise.resolve({});
    }),
  };
  const prisma = {
    bettingSetting,
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ bettingSetting }),
  };
  return { prisma: prisma as unknown as PrismaService, rows, reads };
}

describe('BettingSettingsService', () => {
  const meta = { ip: '127.0.0.1', userAgent: 'jest' };
  let audit: { record: jest.Mock };
  let db: ReturnType<typeof fakePrisma>;
  let settings: BettingSettingsService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-14T12:00:00Z') });
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    db = fakePrisma();
    settings = new BettingSettingsService(db.prisma, audit as unknown as AuditService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('devuelve los valores por defecto de data-model.md', async () => {
    expect(await settings.get('limits.minStake')).toBe(50);
    expect(await settings.get('limits.maxStake')).toBe(50_000);
    expect(await settings.get('limits.maxPayout')).toBe(1_000_000);
    expect(await settings.get('limits.dailyStakePerUser')).toBe(200_000);
    expect(await settings.get('combo.maxSelections')).toBe(10);
    expect(await settings.get('live.delayMs')).toBe(5000);
    expect(await settings.get('suspension.windowMs')).toBe(48 * 3_600_000);
    expect(await settings.get('bonus.rolloverMultiplier')).toBe(5);
    expect(await settings.get('bonus.minOdds')).toBe(150);
    expect(await settings.get('bonus.validDays')).toBe(30);
    expect(Object.keys(await settings.getAll())).toEqual(Object.keys(SETTING_DEFAULTS));
  });

  it('guarda un cambio, lo audita con el valor anterior y el nuevo, y lo aplica al instante', async () => {
    await settings.get('limits.maxStake');
    await settings.set('limits.maxStake', 20_000, 'operador-1', meta);

    expect(await settings.get('limits.maxStake')).toBe(20_000);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'operador-1',
        action: 'settings.changed',
        targetType: 'setting',
        targetId: 'limits.maxStake',
        metadata: { previous: 50_000, value: 20_000 },
        ...meta,
      }),
      expect.anything(),
    );
  });

  it('cachea las lecturas 10 s', async () => {
    await settings.get('limits.minStake');
    await settings.get('limits.maxStake');
    expect(db.reads.count).toBe(1);

    db.rows.set('limits.minStake', 75); // cambio hecho por otra instancia
    expect(await settings.get('limits.minStake')).toBe(50);

    jest.advanceTimersByTime(10_001);
    expect(await settings.get('limits.minStake')).toBe(75);
    expect(db.reads.count).toBe(2);
  });

  it('ignora valores guardados inválidos y usa el valor por defecto', async () => {
    db.rows.set('limits.minStake', 'mucho');
    expect(await settings.get('limits.minStake')).toBe(50);
  });

  it.each([
    ['clave desconocida', 'limits.otra', 10],
    ['no entero', 'limits.maxStake', 10.5],
    ['cero', 'limits.maxStake', 0],
    ['negativo', 'live.delayMs', -1],
    ['fuera de rango', 'combo.maxSelections', 50],
  ])('rechaza %s', async (_, key, value) => {
    await expect(settings.set(key, value, 'op', meta)).rejects.toBeInstanceOf(DomainError);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('exige que el mínimo por apuesta sea menor que el máximo', async () => {
    await expect(settings.set('limits.minStake', 50_000, 'op', meta)).rejects.toThrow(/menor/);
    await expect(settings.set('limits.maxStake', 50, 'op', meta)).rejects.toThrow(/menor/);
    await expect(settings.set('limits.minStake', 100, 'op', meta)).resolves.toBeUndefined();
  });

  it('permite un retardo en vivo de 0 (apuestas en vivo sin espera)', async () => {
    await expect(settings.set('live.delayMs', 0, 'op', meta)).resolves.toBeUndefined();
  });
});
