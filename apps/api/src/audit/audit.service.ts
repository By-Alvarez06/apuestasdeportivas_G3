import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RequestMeta } from '../common/request-meta';

export interface AuditEntry extends RequestMeta {
  /** null en acciones anónimas, p. ej. un login fallido. */
  actorId: string | null;
  /** `<dominio>.<acción>`, p. ej. `auth.login.failed`. */
  action: string;
  targetType?: string;
  targetId?: string;
  /** Sin contraseñas, tokens ni secretos. */
  metadata?: Prisma.InputJsonObject;
}

/** Registro de auditoría de solo agregar; la base de datos rechaza ediciones y borrados. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pasar `tx` cuando la acción auditada ocurre dentro de una transacción: se registran juntas o ninguna. */
  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({ data: { ...entry, metadata: entry.metadata ?? {} } });
  }
}
