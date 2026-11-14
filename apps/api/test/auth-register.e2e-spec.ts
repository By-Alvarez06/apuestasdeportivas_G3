import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { LedgerAccountType, Role, UserStatus } from '../src/generated/prisma/enums';
import { BREACHED_PASSWORD, type FakeMailService, INVALID_CAPTCHA } from './fakes';
import { createTestApp, createTestPrisma, mailOf, resetDatabase, WEB_ORIGIN } from './setup';

const PASSWORD = 'una-clave-larga-1';

/** Fecha YYYY-MM-DD de hace `years` años más `days` días. */
function yearsAgo(years: number, days = 0): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('US1 · Registro (T019)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let mail: FakeMailService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
    mail = mailOf(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.clear();
  });

  const register = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', WEB_ORIGIN)
      .send({ captchaToken: 'ok', password: PASSWORD, birthDate: yearsAgo(30), ...body });

  it('crea una cuenta de apostador sin verificar, con billetera y cuentas contables', async () => {
    await register({ email: ' Ana@Example.COM ' }).expect(202);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'ana@example.com' },
      include: { wallet: true, accounts: true },
    });
    expect(user.role).toBe(Role.BETTOR);
    expect(user.status).toBe(UserStatus.UNVERIFIED);
    expect(user.passwordHash).not.toContain(PASSWORD);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.wallet).not.toBeNull();
    expect(user.accounts.map((a) => a.type).sort()).toEqual(
      [
        LedgerAccountType.USER_BONUS,
        LedgerAccountType.USER_HELD,
        LedgerAccountType.USER_REAL,
      ].sort(),
    );

    expect(mail.to('ana@example.com')).toHaveLength(1);
    expect(mail.lastToken('ana@example.com')).toBeTruthy();
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.register', actorId: user.id } }),
    ).toBe(1);
  });

  it('acepta a quien cumple 18 años hoy', async () => {
    await register({ email: 'justo@example.com', birthDate: yearsAgo(18) }).expect(202);
  });

  it('rechaza a un menor de edad y no crea la cuenta', async () => {
    const res = await register({ email: 'menor@example.com', birthDate: yearsAgo(18, 1) }).expect(
      400,
    );
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(await prisma.user.count()).toBe(0);
  });

  it.each([
    ['corta', 'muy-corta'],
    ['filtrada', BREACHED_PASSWORD],
  ])('rechaza una contraseña %s', async (_, password) => {
    await register({ email: 'debil@example.com', password }).expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('un correo ya registrado responde igual y avisa al dueño', async () => {
    await register({ email: 'dup@example.com' }).expect(202);
    mail.clear();

    const res = await register({ email: 'DUP@example.com', password: 'otra-clave-larga-2' }).expect(
      202,
    );

    expect(res.body).toEqual({});
    expect(await prisma.user.count()).toBe(1);
    const notices = mail.to('dup@example.com');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).not.toMatch(/token=/);
  });

  it('rechaza si la verificación anti-bots falla', async () => {
    await register({ email: 'bot@example.com', captchaToken: INVALID_CAPTCHA }).expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('no deja elegir rol ni estado desde el cliente', async () => {
    await register({ email: 'escala@example.com', role: 'ADMIN', status: 'ACTIVE' }).expect(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it.each([
    { email: 'no-es-correo' },
    { email: 'x@example.com', birthDate: '2000-13-40' },
    { email: 'x@example.com', birthDate: '1850-01-01' },
  ])('valida los campos: %p', async (body) => {
    await register(body).expect(400);
  });
});
