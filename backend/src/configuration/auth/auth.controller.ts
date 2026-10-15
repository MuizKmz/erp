import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { CurrentContext, Public } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { TenantService } from '../../platform/context/tenant.service';
import { SignInSettingsService } from '../settings/sign-in-settings.service';
import type { RequestMeta } from '../shared/security-events.service';
import { AuthService, type Issued } from './auth.service';
import { ForgotDto, LinkDto, ResetPasswordDto, SignInDto, SwitchBranchDto, TwoFactorDto } from './dto/auth.dto';

/** The refresh cookie: httpOnly, only sent to /api/v1/auth, for the device's 30 days (SDD 10.2). */
export const REFRESH_COOKIE = 'zora_refresh';
const COOKIE_PATH = '/api/v1/auth';

function metaOf(req: Request): RequestMeta {
  const agent = req.headers['user-agent'];
  return { ipAddress: req.ip ?? req.socket.remoteAddress ?? null, userAgent: typeof agent === 'string' ? agent : null };
}

/** A02 sign-in — /api/v1/auth. Off (404) with AUTH_MODE=dev, where the user switcher picks the user. */
@Controller('auth')
export class AuthController {
  private readonly jwtMode: boolean;
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly tenants: TenantService,
    private readonly settings: SignInSettingsService,
    config: ConfigService<Env, true>,
  ) {
    this.jwtMode = config.get('AUTH_MODE', { infer: true }) === 'jwt';
    this.secureCookie = config.get('COOKIE_SECURE', { infer: true });
  }

  /** Tells the app whether to show the sign-in page or the dev user switcher, and what the sign-in page says. */
  @Public()
  @Get('mode')
  async mode() {
    const tenantId = await this.tenants.resolve();
    const s = await this.settings.get(tenantId);
    return {
      mode: this.jwtMode ? 'jwt' : 'dev',
      tenantName: await this.tenants.name(),
      signIn: { lockoutAttempts: s.lockoutAttempts, lockoutMinutes: s.lockoutMinutes, refreshDays: s.refreshDays, idleMinutes: s.idleMinutes },
    };
  }

  @Public()
  @Post('sign-in')
  @HttpCode(200)
  async signIn(@Body() dto: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireJwtMode();
    const answer = await this.auth.signIn(dto.identifier, dto.password, metaOf(req));
    // A correct password with two-factor still to do gives only a short-lived ticket, no session and no cookie.
    if (answer.step !== 'DONE') return answer;
    return { step: 'DONE', ...this.answer(res, answer) };
  }

  /** A03 · the code from the app, or a recovery code, after a correct password. */
  @Public()
  @Post('two-factor')
  @HttpCode(200)
  async twoFactor(@Body() dto: TwoFactorDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireJwtMode();
    const issued = await this.auth.verifyTwoFactor(dto.ticket, dto.code, metaOf(req));
    return { ...this.answer(res, issued), ...(issued.recoveryCodesLeft !== undefined && { recoveryCodesLeft: issued.recoveryCodesLeft }) };
  }

  /** A03 · set-up when a role requires two-factor: confirm the secret with a code; the recovery codes come back once. */
  @Public()
  @Post('two-factor/setup')
  @HttpCode(200)
  async twoFactorSetup(@Body() dto: TwoFactorDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireJwtMode();
    const issued = await this.auth.completeSetup(dto.ticket, dto.code, metaOf(req));
    return { ...this.answer(res, issued), recoveryCodes: issued.recoveryCodes };
  }

  /** Forgot password: the same answer whether or not the account exists (FR-SEC-063). */
  @Public()
  @Post('forgot')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotDto, @Req() req: Request) {
    await this.auth.forgot(dto.identifier, metaOf(req));
    return { message: 'If an account matches, a link to reset the password is on its way to its email.' };
  }

  /** What a reset or set-password link is for, before the new password is typed. */
  @Public()
  @Post('link')
  @HttpCode(200)
  link(@Body() dto: LinkDto) {
    return this.auth.checkLink(dto.token);
  }

  @Public()
  @Post('reset')
  @HttpCode(200)
  reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetWithLink(dto.token, dto.newPassword, metaOf(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireJwtMode();
    try {
      return this.answer(res, await this.auth.refresh(this.cookie(req), metaOf(req)));
    } catch (error) {
      res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
      throw error;
    }
  }

  @Public()
  @Post('sign-out')
  @HttpCode(200)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireJwtMode();
    await this.auth.signOut(this.cookie(req), metaOf(req));
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return { signedOut: true };
  }

  /** Signed in, no permission needed: any user may work in any of their own branches. */
  @Post('switch-branch')
  @HttpCode(200)
  async switchBranch(@CurrentContext() ctx: RequestContext, @Body() dto: SwitchBranchDto) {
    this.requireJwtMode();
    const issued = await this.auth.switchBranch(ctx, dto.branchCode.trim().toUpperCase());
    return { accessToken: issued.accessToken, expiresAt: issued.expiresAt, branchCode: issued.branchCode };
  }

  private requireJwtMode(): void {
    if (!this.jwtMode) throw new HttpException({ code: 'NOT_FOUND', message: 'Sign-in is off: the server runs with AUTH_MODE=dev.' }, HttpStatus.NOT_FOUND);
  }

  private cookie(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE];
  }

  /** The access token in the body, the refresh token only in the httpOnly cookie. */
  private answer(res: Response, issued: Issued) {
    if (issued.refreshToken) {
      res.cookie(REFRESH_COOKIE, issued.refreshToken, { httpOnly: true, secure: this.secureCookie, sameSite: 'lax', path: COOKIE_PATH, expires: issued.refreshExpiresAt });
    }
    return { accessToken: issued.accessToken, expiresAt: issued.expiresAt, branchCode: issued.branchCode };
  }
}
