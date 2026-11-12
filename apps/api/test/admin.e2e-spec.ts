import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { ErrorCode } from '@apuestas/shared';
import type { PrismaClient } from '../src/generated/prisma/client';
import { Role, UserStatus } from '../src/generated/prisma/enums';
import { createTestApp, createTestPrisma, resetDatabase, signedInUser, WEB_ORIGIN } from './setup';

const SOME_ID = '00000000-0000-4000-8000-000000000000';

// Todas las rutas de administración (contracts/http-api.md § Administración).
const ADMIN_ROUTES: [method: 'get' | 'patch' | 'post', path: string][] = [
  ['get', '/admin/users'],
  ['patch', `/admin/users/${SOME_ID}/role`],
  ['patch', `/admin/users/${SOME_ID}/status`],
  ['get', '/admin/withdrawals'],
  ['post', `/admin/withdrawals/${SOME_ID}/approve`],
  ['post', `/admin/withdrawals/${SOME_ID}/reject`],
  ['post', '/admin/ledger/adjustments'],
  ['get', '/admin/audit'],
];

describe('US5 · Administración y autorización (T058, SC-007)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let admin: { id: string; cookie: string };

  beforeAll(async () => {
    prisma = createTestPrisma();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await signedInUser(app, prisma, { role: Role.ADMIN });
  });

  const call = (method: 'get' | 'patch' | 'post', path: string, cookie: string, body = {}) => {
    const agent = request(app.getHttpServer());
    return agent[method](path)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookie)
      .set('Idempotency-Key', `admin-${Date.now()}-${Math.random()}`)
      .send(body);
  };

  it.each([Role.BETTOR, Role.OPERATOR])(
    'cada ruta de administración responde 403 a %s y queda auditado',
    async (role) => {
      const { cookie } = await signedInUser(app, prisma, { role });
      for (const [method, path] of ADMIN_ROUTES) {
        const res = await call(method, path, cookie);
        expect({ path, status: res.status }).toEqual({ path, status: 403 });
      }
      expect(await prisma.auditLog.count({ where: { action: 'access.denied' } })).toBe(
        ADMIN_ROUTES.length,
      );
    },
  );

  it('sin sesión, cada ruta de administración responde 401', async () => {
    for (const [method, path] of ADMIN_ROUTES) {
      const res = await request(app.getHttpServer())[method](path).set('Origin', WEB_ORIGIN);
      expect({ path, status: res.status }).toEqual({ path, status: 401 });
    }
  });

  it('lista usuarios con filtros y sin datos sensibles', async () => {
    await signedInUser(app, prisma, { role: Role.OPERATOR });
    await signedInUser(app, prisma, { status: UserStatus.SUSPENDED });
    const all = await call('get', '/admin/users', admin.cookie).expect(200);
    expect(all.body.total).toBe(3);
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash|totpSecret/);

    const operators = await call('get', '/admin/users?role=OPERATOR', admin.cookie).expect(200);
    expect(operators.body.items.map((u: { role: string }) => u.role)).toEqual(['OPERATOR']);
    const suspended = await call('get', '/admin/users?status=SUSPENDED', admin.cookie).expect(200);
    expect(suspended.body.total).toBe(1);
    const byEmail = await call('get', '/admin/users?email=operator', admin.cookie).expect(200);
    expect(byEmail.body.total).toBe(1);
  });

  it('cambiar un rol se aplica al instante y queda auditado con from/to', async () => {
    const target = await signedInUser(app, prisma, { role: Role.BETTOR });
    await call('patch', `/admin/users/${target.id}/role`, admin.cookie, {
      role: 'OPERATOR',
    }).expect(200);

    // La sesión ya abierta del usuario ve el rol nuevo sin volver a iniciar sesión.
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', target.cookie)
      .expect(200);
    expect(me.body.role).toBe('OPERATOR');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.role.changed' } });
    expect(log).toMatchObject({ actorId: admin.id, targetId: target.id });
    expect(log.metadata).toEqual({ from: 'BETTOR', to: 'OPERATOR' });
  });

  it('pasar a apostador a quien no tenía billetera se la crea', async () => {
    const operator = await signedInUser(app, prisma, { role: Role.OPERATOR });
    await call('patch', `/admin/users/${operator.id}/role`, admin.cookie, {
      role: 'BETTOR',
    }).expect(200);
    const wallet = await request(app.getHttpServer())
      .get('/wallet')
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(wallet.body.real).toBe('0.00');
  });

  it('el único administrador no puede quitarse el rol', async () => {
    const res = await call('patch', `/admin/users/${admin.id}/role`, admin.cookie, {
      role: 'BETTOR',
    }).expect(409);
    expect(res.body.error.code).toBe(ErrorCode.CONFLICT);
    // Con otro administrador activo, sí puede.
    await signedInUser(app, prisma, { role: Role.ADMIN });
    await call('patch', `/admin/users/${admin.id}/role`, admin.cookie, { role: 'OPERATOR' }).expect(
      200,
    );
  });

  it('suspender cierra la sesión al instante e impide iniciar sesión', async () => {
    const target = await signedInUser(app, prisma);
    await call('patch', `/admin/users/${target.id}/status`, admin.cookie, {
      status: 'SUSPENDED',
    }).expect(200);
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', target.cookie).expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', target.cookie)
      .expect(401);
    expect(await prisma.auditLog.count({ where: { action: 'user.status.changed' } })).toBe(1);

    await call('patch', `/admin/users/${target.id}/status`, admin.cookie, {
      status: 'ACTIVE',
    }).expect(200);
  });

  it('un administrador no puede suspenderse a sí mismo', async () => {
    await call('patch', `/admin/users/${admin.id}/status`, admin.cookie, {
      status: 'SUSPENDED',
    }).expect(409);
  });

  it('valida el rol y el estado', async () => {
    const target = await signedInUser(app, prisma);
    await call('patch', `/admin/users/${target.id}/role`, admin.cookie, { role: 'DIOS' }).expect(
      400,
    );
    await call('patch', `/admin/users/${target.id}/status`, admin.cookie, {
      status: 'UNVERIFIED',
    }).expect(400);
    await call('patch', `/admin/users/${SOME_ID}/role`, admin.cookie, { role: 'BETTOR' }).expect(
      404,
    );
  });
});
