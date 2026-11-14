import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BreachedPasswordChecker } from './breached-password.checker';
import { CaptchaService } from './captcha.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';

@Module({
  controllers: [AuthController, TwoFactorController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    BreachedPasswordChecker,
    CaptchaService,
    TwoFactorService,
  ],
  exports: [AuthService, TokenService, PasswordService, TwoFactorService],
})
export class AuthModule {}
