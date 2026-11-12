import { Body, Controller, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { toCents } from '@apuestas/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { validationError } from '../common/errors/domain-error';
import { IdempotencyKey } from '../common/idempotency-key.decorator';
import { Meta, type RequestMeta } from '../common/request-meta';
import { LedgerAccountType, LedgerTransactionType, Role } from '../generated/prisma/enums';
import { WalletService } from './wallet.service';

export class AdjustmentDto {
  @IsUUID()
  userId!: string;

  @IsIn(['REAL', 'BONUS'], { message: 'La cuenta debe ser REAL o BONUS.' })
  account!: 'REAL' | 'BONUS';

  /** Con signo: "5.00" acredita al usuario, "-5.00" le debita. */
  @Matches(/^-?\d+(\.\d{1,2})?$/, { message: 'El monto debe tener el formato 5.00 o -5.00.' })
  amount!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Escribe el motivo de la corrección.' })
  @MaxLength(500)
  reason!: string;
}

const ACCOUNT = { REAL: LedgerAccountType.USER_REAL, BONUS: LedgerAccountType.USER_BONUS } as const;

/** Correcciones de FR-015: asientos compensatorios contra la casa, solo por un administrador y auditados. */
@Roles(Role.ADMIN)
@Controller('admin/ledger/adjustments')
export class AdjustmentsController {
  constructor(
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(
    @CurrentUser() admin: AuthUser,
    @Body() dto: AdjustmentDto,
    @IdempotencyKey() key: string,
    @Meta() meta: RequestMeta,
  ) {
    const negative = dto.amount.startsWith('-');
    let amount: number;
    try {
      amount = toCents(dto.amount.replace('-', ''));
    } catch {
      throw validationError('El monto de la corrección no puede ser 0.');
    }
    const userAccount = ACCOUNT[dto.account];
    const transactionId = await this.wallet.transfer({
      userId: dto.userId,
      amount,
      from: negative ? userAccount : LedgerAccountType.HOUSE,
      to: negative ? LedgerAccountType.HOUSE : userAccount,
      type: LedgerTransactionType.ADJUSTMENT,
      idempotencyKey: `adjustment:${admin.id}:${key}`,
      reference: { type: 'adjustment', id: dto.userId },
      reason: dto.reason,
      createdById: admin.id,
    });
    await this.audit.record({
      actorId: admin.id,
      action: 'ledger.adjustment',
      targetType: 'user',
      targetId: dto.userId,
      metadata: { account: dto.account, amount: dto.amount, reason: dto.reason, transactionId },
      ...meta,
    });
    return { transactionId };
  }
}
