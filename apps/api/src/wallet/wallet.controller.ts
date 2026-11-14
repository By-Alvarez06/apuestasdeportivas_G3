import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { fromCents, type Money } from '@apuestas/shared';
import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators';
import { LedgerAccountType, LedgerTransactionType, Role } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

export class MovementsQuery {
  @IsOptional()
  @IsEnum(LedgerTransactionType)
  type?: LedgerTransactionType;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

const POCKET = {
  [LedgerAccountType.USER_REAL]: 'REAL',
  [LedgerAccountType.USER_BONUS]: 'BONUS',
  [LedgerAccountType.USER_HELD]: 'HELD',
} as const;

export interface Movement {
  id: string;
  type: LedgerTransactionType;
  account: 'REAL' | 'BONUS' | 'HELD';
  amount: Money;
  reference: { type: string; id: string };
  createdAt: string;
}

/** contracts/http-api.md § Billetera (FR-019). */
@Roles(Role.BETTOR)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async balances(@CurrentUser() user: AuthUser) {
    const { real, bonus, held } = await this.wallet.getBalances(user.id);
    return {
      real: fromCents(real),
      bonus: fromCents(bonus),
      held: fromCents(held),
      currency: 'USD',
    };
  }

  @Get('movements')
  async movements(@CurrentUser() user: AuthUser, @Query() query: MovementsQuery) {
    const where = {
      account: { userId: user.id },
      transaction: {
        type: query.type,
        createdAt: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
    };
    const [total, rows] = await Promise.all([
      this.prisma.ledgerPosting.count({ where }),
      this.prisma.ledgerPosting.findMany({
        where,
        include: { account: { select: { type: true } }, transaction: true },
        orderBy: [{ transaction: { createdAt: 'desc' } }, { transactionId: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items: Movement[] = rows.map((p) => ({
      id: p.id,
      type: p.transaction.type,
      account: POCKET[p.account.type as keyof typeof POCKET],
      amount: fromCents(p.amount),
      reference: { type: p.transaction.referenceType, id: p.transaction.referenceId },
      createdAt: p.transaction.createdAt.toISOString(),
    }));
    return { items, page: query.page, pageSize: query.pageSize, total };
  }
}
