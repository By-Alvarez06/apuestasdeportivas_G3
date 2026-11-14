import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';

const DEV_SECRET = 'change-me-in-production';

/** JWT y guards globales: toda ruta exige sesión y rol salvo las marcadas @Public(). */
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_SECRET');
        if (
          config.get('NODE_ENV') === 'production' &&
          (secret === DEV_SECRET || secret.length < 32)
        )
          throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
        return {
          secret,
          signOptions: { expiresIn: config.get('JWT_EXPIRATION', '15m') },
        };
      },
    }),
  ],
  providers: [
    // El orden importa: primero se autentica, luego se autoriza.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AccessModule {}
