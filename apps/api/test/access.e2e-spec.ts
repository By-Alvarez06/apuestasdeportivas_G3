import { Controller, Get, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import { Public, Roles } from '../src/common/auth/decorators';
import { IdempotencyKey } from '../src/common/idempotency-key.decorator';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role, UserStatus } from '../src/generated/prisma/enums';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser, WEB_ORIGIN } from './setup';

// Rutas de prueba montadas detrás de los guards globales reales.
@Controller('probe')
class ProbeController {
  @Public()
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('no-roles')
  noRoles() {
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Roles(Role.BETTOR, Role.ADMIN)
  @Get('bettor')
  bettor() {
    return { ok: true };
  }

  @Public()
  @Post('money')
  money(@IdempotencyKey() key: string) {
    return { key };
  }
}

describe('Acceso, errores y protecciones comunes (T015–T018)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp({ controllers: [ProbeController] });
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => resetDatabase(prisma));

  async function cookieFor(role: Role, status: UserStatus = UserStatus.ACTIVE): Promise<string> {
    return (await signedInUser(app, prisma, { role, status })).cookie;
  }

  const get = (path: string, cookie?: string) => {
    const req = request(app.getHttpServer()).get(path);
    return cookie ? req.set('Cookie', cookie) : req;
  };

  it('/health es público', async () => {
    await get('/health').expect(200);
  });

  it('una ruta pública no pide sesión', async () => {
    await get('/probe/open').expect(200);
  });

  it('sin sesión responde 401 con el formato de error', async () => {
    const res = await get('/probe/admin').expect(401);
    expect(res.body).toEqual({
      error: { code: ErrorCode.UNAUTHENTICATED, message: expect.any(String) },
    });
  });

  it('un token inválido o firmado con otra clave responde 401', async () => {
    const forged = new JwtService({ secret: 'otra-clave' }).sign({ sub: 'x' });
    await get('/probe/admin', `access_token=${forged}`).expect(401);
    await get('/probe/admin', 'access_token=basura').expect(401);
  });

  it('un token bien firmado pero sin sesión activa responde 401', async () => {
    const { id } = await signedInUser(app, prisma, { role: Role.ADMIN });
    await get('/probe/admin', `access_token=${await jwt.signAsync({ sub: id })}`).expect(401);
    const sid = crypto.randomUUID();
    await get('/probe/admin', `access_token=${await jwt.signAsync({ sub: id, sid })}`).expect(401);
  });

  it('un usuario suspendido no pasa aunque su token sea válido', async () => {
    await get('/probe/admin', await cookieFor(Role.ADMIN, UserStatus.SUSPENDED)).expect(401);
  });

  it('una ruta sin @Roles se deniega por defecto incluso a un administrador', async () => {
    await get('/probe/no-roles', await cookieFor(Role.ADMIN)).expect(403);
  });

  it('un rol no autorizado responde 403 y queda auditado', async () => {
    const res = await get('/probe/admin', await cookieFor(Role.BETTOR)).expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
    const logs = await prisma.auditLog.findMany({ where: { action: 'access.denied' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.metadata).toMatchObject({ path: '/probe/admin', role: Role.BETTOR });
    expect(logs[0]!.actorId).not.toBeNull();
  });

  it('el rol autorizado pasa', async () => {
    await get('/probe/admin', await cookieFor(Role.ADMIN)).expect(200);
    await get('/probe/bettor', await cookieFor(Role.BETTOR)).expect(200);
    await get('/probe/bettor', await cookieFor(Role.OPERATOR)).expect(403);
  });

  it('rechaza peticiones que cambian estado desde otro origen', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/money')
      .set('Origin', 'https://evil.example')
      .set('Idempotency-Key', 'clave-valida-1')
      .expect(403);
    expect(res.body.error.code).toBe(ErrorCode.FORBIDDEN);
  });

  it('exige un Idempotency-Key válido', async () => {
    const post = () => request(app.getHttpServer()).post('/probe/money').set('Origin', WEB_ORIGIN);
    const missing = await post().expect(400);
    expect(missing.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
    await post().set('Idempotency-Key', 'corta').expect(400);
    await post().set('Idempotency-Key', 'tiene espacios!!').expect(400);
    const ok = await post().set('Idempotency-Key', 'deposito:abc-123').expect(201);
    expect(ok.body).toEqual({ key: 'deposito:abc-123' });
  });

  it('una ruta inexistente responde 404 con el formato de error', async () => {
    const res = await get('/no-existe').expect(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
  });
});
