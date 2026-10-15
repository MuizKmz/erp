import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentContext } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import type { RequestMeta } from '../shared/security-events.service';
import { AccountService } from './account.service';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Type your current password.' })
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @IsNotEmpty({ message: 'Type a new password.' })
  @MaxLength(200)
  newPassword!: string;
}

export class CodeDto {
  @IsString()
  @IsNotEmpty({ message: 'Type the code from the app.' })
  @MaxLength(20)
  code!: string;
}

export class PasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Type your password.' })
  @MaxLength(200)
  password!: string;
}

function metaOf(req: Request): RequestMeta {
  const agent = req.headers['user-agent'];
  return { ipAddress: req.ip ?? req.socket.remoteAddress ?? null, userAgent: typeof agent === 'string' ? agent : null };
}

/** A11 · My account — /api/v1/account. Signed in, no permission: everyone manages their own password, two-factor and devices. */
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  view(@CurrentContext() ctx: RequestContext) {
    return this.account.view(ctx);
  }

  @Post('password')
  @HttpCode(200)
  changePassword(@CurrentContext() ctx: RequestContext, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.account.changePassword(ctx, dto.currentPassword, dto.newPassword, metaOf(req));
  }

  @Delete('sessions/:id')
  endSession(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.account.endSession(ctx, id, metaOf(req));
  }

  @Post('sessions/sign-out-others')
  @HttpCode(200)
  endOthers(@CurrentContext() ctx: RequestContext, @Req() req: Request) {
    return this.account.endOtherSessions(ctx, metaOf(req));
  }

  @Post('two-factor/setup')
  @HttpCode(200)
  startTwoFactor(@CurrentContext() ctx: RequestContext) {
    return this.account.startTwoFactor(ctx);
  }

  @Post('two-factor/enable')
  @HttpCode(200)
  enableTwoFactor(@CurrentContext() ctx: RequestContext, @Body() dto: CodeDto, @Req() req: Request) {
    return this.account.enableTwoFactor(ctx, dto.code, metaOf(req));
  }

  @Post('two-factor/disable')
  @HttpCode(200)
  disableTwoFactor(@CurrentContext() ctx: RequestContext, @Body() dto: PasswordDto, @Req() req: Request) {
    return this.account.disableTwoFactor(ctx, dto.password, metaOf(req));
  }

  @Post('two-factor/recovery-codes')
  @HttpCode(200)
  newRecoveryCodes(@CurrentContext() ctx: RequestContext, @Body() dto: PasswordDto, @Req() req: Request) {
    return this.account.newRecoveryCodes(ctx, dto.password, metaOf(req));
  }
}
