import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { argon2id, hash, verify as verifyHash } from 'argon2';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import { ErrorCode } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import type { RequestMeta } from '../common/request-meta';
import { PrismaService } from '../prisma/prisma.service';

const ISSUER = 'Apuestas Deportivas';
const RECOVERY_CODES = 10;
// Ventana de ±1 paso (30 s) para tolerar relojes desfasados.
const totp = authenticator.clone({ window: 1 });
// Sin caracteres que se confunden al copiar a mano (0/O, 1/l/I).
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export const twoFactorRequired = (message: string) =>
  new DomainError(ErrorCode.TWO_FACTOR_REQUIRED, message, HttpStatus.FORBIDDEN);

/** 2FA TOTP de FR-007: secreto cifrado con AES-256-GCM y códigos de recuperación de un solo uso. */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Genera un secreto nuevo (pendiente hasta `enable`). */
  async setup(userId: string): Promise<{ otpauthUrl: string; qrDataUrl: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt)
      throw new DomainError(
        ErrorCode.CONFLICT,
        'La verificación en dos pasos ya está activa en tu cuenta.',
        HttpStatus.CONFLICT,
      );
    const secret = totp.generateSecret(20); // 160 bits, lo recomendado por RFC 4226
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: this.encrypt(secret) },
    });
    const otpauthUrl = totp.keyuri(user.email, ISSUER, secret);
    return { otpauthUrl, qrDataUrl: await toDataURL(otpauthUrl) };
  }

  /** Activa 2FA si el código de la app es correcto; los códigos de recuperación se muestran una sola vez. */
  async enable(userId: string, code: string, meta: RequestMeta): Promise<string[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt || !user.totpSecretEnc || !this.totpValid(user.totpSecretEnc, code))
      throw twoFactorRequired(
        'El código no es correcto. Revisa la hora del teléfono e inténtalo de nuevo.',
      );

    const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
    // Se guarda sin guion: el usuario puede escribirlo con o sin él.
    const hashes = await Promise.all(
      codes.map((c) => hash(c.replace('-', ''), { type: argon2id })),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) });
      await tx.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
      await this.audit.record({ actorId: userId, action: 'auth.2fa.enabled', ...meta }, tx);
    });
    return codes;
  }

  /** Acepta un código de 6 dígitos de la app o un código de recuperación sin usar (que queda gastado). */
  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt || !user.totpSecretEnc) return false;
    const input = code.toLowerCase().replace(/[\s-]+/g, '');
    if (/^\d{6}$/.test(input)) return this.totpValid(user.totpSecretEnc, input);

    const unused = await this.prisma.recoveryCode.findMany({ where: { userId, usedAt: null } });
    for (const row of unused) {
      if (await verifyHash(row.codeHash, input)) {
        // updateMany con usedAt null: dos usos simultáneos del mismo código, solo uno vale.
        const { count } = await this.prisma.recoveryCode.updateMany({
          where: { id: row.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return count === 1;
      }
    }
    return false;
  }

  // shortcut: un mismo código TOTP vale durante su ventana (±30 s); guardar el último paso usado si se exige anti-repetición.
  private totpValid(secretEnc: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    return totp.verify({ token: code, secret: this.decrypt(secretEnc) });
  }

  private key(): Buffer {
    const key = Buffer.from(this.config.getOrThrow<string>('TOTP_ENC_KEY'), 'base64');
    if (key.length !== 32)
      throw new Error(
        'TOTP_ENC_KEY debe ser 32 bytes en base64: genera una con `openssl rand -base64 32`',
      );
    return key;
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
  }

  private decrypt(stored: string): string {
    const [iv, tag, data] = stored.split('.').map((part) => Buffer.from(part, 'base64'));
    if (!iv || !tag || !data) throw new Error('Secreto TOTP con formato inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}

function recoveryCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}
