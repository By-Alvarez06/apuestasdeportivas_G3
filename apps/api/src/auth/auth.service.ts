import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode, PORTS } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError, validationError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { Prisma } from '../generated/prisma/client';
import {
  EmailTokenPurpose,
  LedgerAccountType,
  type Role,
  UserStatus,
} from '../generated/prisma/enums';
import { type MailMessage, MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  accountLockedMail,
  duplicateRegistrationMail,
  passwordResetMail,
  verificationMail,
} from './auth.mails';
import type { LoginDto, RegisterDto } from './auth.dto';
import { CaptchaService } from './captcha.service';
import { PasswordService } from './password.service';
import { type Session, sha256, TokenService } from './token.service';

const MINUTE = 60 * 1000;
export const LOCK_WINDOW_MS = 15 * MINUTE;
export const MAX_FAILED_LOGINS = 5;
const VERIFY_TTL_MS = 24 * 60 * MINUTE;
const RESET_TTL_MS = 60 * MINUTE;
const MIN_AGE = 18;

const invalidCredentials = () =>
  new DomainError(
    ErrorCode.UNAUTHENTICATED,
    'Correo o contraseña incorrectos.',
    HttpStatus.UNAUTHORIZED,
  );

const accountLocked = () =>
  new DomainError(
    ErrorCode.ACCOUNT_LOCKED,
    'Tu cuenta está bloqueada por demasiados intentos fallidos. Inténtalo de nuevo en 15 minutos.',
    HttpStatus.LOCKED,
  );

const tokenGone = () =>
  new DomainError(
    ErrorCode.TOKEN_EXPIRED,
    'El enlace no es válido o ya venció. Pide uno nuevo.',
    HttpStatus.GONE,
  );

export interface Me {
  id: string;
  email: string;
  role: Role;
  status: UserStatus;
  twoFactorEnabled: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly webUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly captcha: CaptchaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.webUrl = config.get<string>('WEB_URL', `http://localhost:${PORTS.WEB}`);
  }

  /** FR-001/FR-006: responde igual exista o no el correo; al dueño de un correo existente solo se le avisa. */
  async register(dto: RegisterDto, meta: RequestMeta): Promise<void> {
    await this.captcha.verify(dto.captchaToken, meta.ip);
    const birthDate = parseBirthDate(dto.birthDate);
    await this.passwords.assertAcceptable(dto.password);

    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) return this.notifyDuplicate(existing.id, dto.email, meta);

    const passwordHash = await this.passwords.hash(dto.password);
    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            birthDate,
            wallet: { create: {} },
            accounts: {
              create: [
                { type: LedgerAccountType.USER_REAL },
                { type: LedgerAccountType.USER_BONUS },
                { type: LedgerAccountType.USER_HELD },
              ],
            },
          },
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'auth.register',
            targetType: 'user',
            targetId: user.id,
            ...meta,
          },
          tx,
        );
        return user.id;
      });
    } catch (error) {
      // Dos registros simultáneos con el mismo correo: el perdedor se trata como duplicado.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.user.findUniqueOrThrow({ where: { email: dto.email } });
        return this.notifyDuplicate(winner.id, dto.email, meta);
      }
      throw error;
    }

    const token = await this.createEmailToken(
      userId,
      EmailTokenPurpose.VERIFY_EMAIL,
      VERIFY_TTL_MS,
    );
    await this.sendSafely(verificationMail(dto.email, this.link('/verificar-correo', token)));
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const userId = await this.consumeEmailToken(token, EmailTokenPurpose.VERIFY_EMAIL);
    await this.prisma.user.updateMany({
      where: { id: userId, status: UserStatus.UNVERIFIED },
      data: { status: UserStatus.ACTIVE },
    });
    await this.audit.record({ actorId: userId, action: 'auth.email.verified', ...meta });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status !== UserStatus.UNVERIFIED) return;
    const token = await this.createEmailToken(
      user.id,
      EmailTokenPurpose.VERIFY_EMAIL,
      VERIFY_TTL_MS,
    );
    await this.sendSafely(verificationMail(email, this.link('/verificar-correo', token)));
  }

  /**
   * FR-005: 5 fallos en 15 minutos (desde el último acceso correcto) bloquean el correo, exista o no
   * la cuenta, para no revelar cuáles existen. Mientras está bloqueado no se evalúa la contraseña.
   */
  async login(dto: LoginDto, meta: RequestMeta): Promise<Session> {
    await this.captcha.verify(dto.captchaToken, meta.ip);
    const failures = await this.recentFailures(dto.email);
    if (failures >= MAX_FAILED_LOGINS) throw accountLocked();

    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = await this.passwords.verify(user?.passwordHash ?? null, dto.password);

    if (!user || !valid || user.status === UserStatus.SUSPENDED) {
      await this.prisma.loginAttempt.create({
        data: { email: dto.email, userId: user?.id ?? null, ip: meta.ip, success: false },
      });
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login.failed',
        metadata: { email: dto.email },
        ...meta,
      });
      if (failures + 1 === MAX_FAILED_LOGINS) {
        await this.audit.record({
          actorId: user?.id ?? null,
          action: 'auth.account.locked',
          metadata: { email: dto.email },
          ...meta,
        });
        if (user) await this.sendSafely(accountLockedMail(user.email));
      }
      throw invalidCredentials();
    }

    await this.prisma.loginAttempt.create({
      data: { email: dto.email, userId: user.id, ip: meta.ip, success: true },
    });
    await this.audit.record({ actorId: user.id, action: 'auth.login.success', ...meta });
    return this.tokens.issueSession(user.id, meta);
  }

  async logout(userId: string, familyId: string, meta: RequestMeta): Promise<void> {
    await this.tokens.revokeFamily(familyId);
    await this.audit.record({ actorId: userId, action: 'auth.logout', ...meta });
  }

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status === UserStatus.SUSPENDED) return;
    const token = await this.createEmailToken(
      user.id,
      EmailTokenPurpose.RESET_PASSWORD,
      RESET_TTL_MS,
    );
    await this.audit.record({ actorId: user.id, action: 'auth.password.reset.requested', ...meta });
    await this.sendSafely(passwordResetMail(email, this.link('/recuperar/nueva', token)));
  }

  /** FR-008: cambia la contraseña y cierra todas las sesiones. */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    // Primero la política: una contraseña rechazada no gasta el enlace.
    await this.passwords.assertAcceptable(password);
    const userId = await this.consumeEmailToken(token, EmailTokenPurpose.RESET_PASSWORD);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(password) },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.record({ actorId: userId, action: 'auth.password.reset', ...meta });
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      twoFactorEnabled: user.totpEnabledAt !== null,
    };
  }

  private async recentFailures(email: string): Promise<number> {
    const windowStart = new Date(Date.now() - LOCK_WINDOW_MS);
    const lastSuccess = await this.prisma.loginAttempt.findFirst({
      where: { email, success: true, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return this.prisma.loginAttempt.count({
      where: { email, success: false, createdAt: { gte: lastSuccess?.createdAt ?? windowStart } },
    });
  }

  private async notifyDuplicate(userId: string, email: string, meta: RequestMeta): Promise<void> {
    await this.audit.record({ actorId: userId, action: 'auth.register.duplicate', ...meta });
    await this.sendSafely(duplicateRegistrationMail(email, this.link('/ingresar')));
  }

  private async createEmailToken(
    userId: string,
    purpose: EmailTokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.emailToken.create({
      data: { userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return token;
  }

  /** Marca el token como usado de forma atómica y devuelve su usuario; si no sirve, 410. */
  private async consumeEmailToken(token: string, purpose: EmailTokenPurpose): Promise<string> {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt <= new Date())
      throw tokenGone();
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw tokenGone();
    return row.userId;
  }

  private link(path: string, token?: string): string {
    return token ? `${this.webUrl}${path}?token=${token}` : `${this.webUrl}${path}`;
  }

  /** Un fallo de SMTP no debe tumbar el registro ni filtrar si la cuenta existe; el usuario puede pedir reenvío. */
  private async sendSafely(message: MailMessage): Promise<void> {
    try {
      await this.mail.send(message);
    } catch (error) {
      this.logger.error(`No se pudo enviar "${message.subject}": ${String(error)}`);
    }
  }
}

/** AAAA-MM-DD real, desde 1900, y edad ≥ 18 según el reloj del servidor (UTC). */
export function parseBirthDate(value: string, now = new Date()): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw validationError('La fecha de nacimiento no es válida.');
  if (date.getUTCFullYear() < 1900 || date > now)
    throw validationError('La fecha de nacimiento no es válida.');
  const adultFrom = Date.UTC(
    date.getUTCFullYear() + MIN_AGE,
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (adultFrom > today) throw validationError('Debes tener al menos 18 años para registrarte.');
  return date;
}
