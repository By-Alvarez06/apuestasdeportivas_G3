import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../common/auth/auth.guard';
import { type AuthUser, CurrentUser, Public, Roles } from '../common/auth/decorators';
import { unauthenticated } from '../common/errors/domain-error';
import { Meta, type RequestMeta } from '../common/request-meta';
import { Role } from '../generated/prisma/enums';
import { EmailDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto } from './auth.dto';
import { AuthService, type Me } from './auth.service';
import { REFRESH_TTL_MS, type Session, TokenService } from './token.service';

export const REFRESH_COOKIE = 'refresh_token';
const ACCESS_TTL_MS = 15 * 60 * 1000;

const ALL_ROLES = [Role.BETTOR, Role.OPERATOR, Role.ADMIN];

/** Rutas de contracts/http-api.md § Autenticación. Limitadas por IP (FR-005). */
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  private readonly secure: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    config: ConfigService,
  ) {
    this.secure = config.get('NODE_ENV') === 'production';
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() dto: RegisterDto, @Meta() meta: RequestMeta): Promise<object> {
    await this.auth.register(dto, meta);
    return {};
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: TokenDto, @Meta() meta: RequestMeta): Promise<void> {
    return this.auth.verifyEmail(dto.token, meta);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Body() dto: EmailDto): Promise<object> {
    await this.auth.resendVerification(dto.email);
    return {};
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body() dto: LoginDto,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    this.setSessionCookies(res, await this.auth.login(dto, meta));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() req: Request,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw unauthenticated();
    try {
      this.setSessionCookies(res, await this.tokens.rotate(token, meta));
    } catch (error) {
      this.clearSessionCookies(res);
      throw error;
    }
  }

  @Roles(...ALL_ROLES)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthUser,
    @Meta() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.id, user.sessionId, meta);
    this.clearSessionCookies(res);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() dto: EmailDto, @Meta() meta: RequestMeta): Promise<object> {
    await this.auth.forgotPassword(dto.email, meta);
    return {};
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() dto: ResetPasswordDto, @Meta() meta: RequestMeta): Promise<void> {
    return this.auth.resetPassword(dto.token, dto.password, meta);
  }

  @Roles(...ALL_ROLES)
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.auth.me(user.id);
  }

  private cookieOptions(path: string, maxAge: number): CookieOptions {
    return { httpOnly: true, secure: this.secure, sameSite: 'lax', path, maxAge };
  }

  private setSessionCookies(res: Response, session: Session): void {
    res.cookie(ACCESS_COOKIE, session.accessToken, this.cookieOptions('/', ACCESS_TTL_MS));
    // Solo viaja a /auth (refresh y logout), nunca al resto de la API.
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.cookieOptions('/auth', REFRESH_TTL_MS));
  }

  private clearSessionCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }
}
