import { hash } from 'argon2';
import { Role, UserStatus } from '../src/generated/prisma/enums';
import { createPrismaClient } from '../src/prisma/prisma.service';
import { ensureSystemAccounts } from '../src/wallet/system-accounts';

// Cuentas del sistema y primer administrador (spec 2, Assumptions). Se puede correr varias veces.
async function main(): Promise<void> {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!DATABASE_URL) throw new Error('Falta DATABASE_URL');
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Faltan ADMIN_EMAIL o ADMIN_PASSWORD');
  if (ADMIN_PASSWORD.length < 10)
    throw new Error('ADMIN_PASSWORD debe tener al menos 10 caracteres');

  const prisma = createPrismaClient(DATABASE_URL);
  try {
    await ensureSystemAccounts(prisma);
    const email = ADMIN_EMAIL.trim().toLowerCase();
    // Solo crea: nunca pisa la contraseña de un administrador existente.
    if (!(await prisma.user.findUnique({ where: { email } }))) {
      await prisma.user.create({
        data: {
          email,
          passwordHash: await hash(ADMIN_PASSWORD),
          birthDate: new Date('1970-01-01'),
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      console.log(`Administrador ${email} creado`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
