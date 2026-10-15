import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { CreateUserDto, UpdateUserDto, UserListQueryDto, UserVersionDto } from './dto/user.dto';
import { UserSignInService } from './user-sign-in.service';
import { UsersQuery } from './users.query';
import { UsersService } from './users.service';

/** A06 users and A07 user — /api/v1/config/users. Users are deactivated, never deleted (rule 3). */
@Controller('config/users')
export class ConfigUsersController {
  constructor(
    private readonly query: UsersQuery,
    private readonly service: UsersService,
    private readonly signIn: UserSignInService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() query: UserListQueryDto) {
    return this.query.list(ctx, query);
  }

  @Get('lookups')
  @RequirePermission(P.VIEW)
  lookups(@CurrentContext() ctx: RequestContext) {
    return this.query.lookups(ctx);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Post()
  @RequirePermission(P.USER_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateUserDto) {
    return this.service.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission(P.USER_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.service.update(ctx, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermission(P.USER_EDIT)
  deactivate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserVersionDto) {
    return this.service.setActive(ctx, id, false, dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.USER_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UserVersionDto) {
    return this.service.setActive(ctx, id, true, dto.version);
  }

  /** A07 · Sign-in card (A6). */
  @Post(':id/send-link')
  @HttpCode(200)
  @RequirePermission(P.USER_EDIT)
  sendLink(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.signIn.sendLink(ctx, id);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(200)
  @RequirePermission(P.USER_EDIT)
  revokeSessions(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.signIn.revokeSessions(ctx, id);
  }

  @Post(':id/reset-two-factor')
  @HttpCode(200)
  @RequirePermission(P.USER_EDIT)
  resetTwoFactor(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.signIn.resetTwoFactor(ctx, id);
  }

  @Post(':id/unlock')
  @HttpCode(200)
  @RequirePermission(P.USER_EDIT)
  unlock(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.signIn.unlock(ctx, id);
  }
}
