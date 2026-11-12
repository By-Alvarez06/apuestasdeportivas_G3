import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BreachedPasswordChecker } from './breached-password.checker';
import { CaptchaService } from './captcha.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordService, BreachedPasswordChecker, CaptchaService],
  exports: [AuthService, TokenService, PasswordService],
})
export class AuthModule {}
