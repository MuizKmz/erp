import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { CompareRolesQueryDto, CreateRoleDto, RoleVersionDto, UpdateRoleDto } from './dto/role.dto';
import { RolesQuery } from './roles.query';
import { RolesService } from './roles.service';

/** A08 roles and A09 role — /api/v1/config/roles */
@Controller('config/roles')
export class ConfigRolesController {
  constructor(
    private readonly query: RolesQuery,
    private readonly service: RolesService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.list(ctx);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }

  @Post()
  @RequirePermission(P.ROLE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateRoleDto) {
    return this.service.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission(P.ROLE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.service.update(ctx, id, dto);
  }

  @Post(':id/reset-to-starter')
  @RequirePermission(P.ROLE_EDIT)
  reset(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleVersionDto) {
    return this.service.resetToStarter(ctx, id, dto.version);
  }

  @Delete(':id')
  @RequirePermission(P.ROLE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() dto: RoleVersionDto) {
    return this.service.remove(ctx, id, dto.version);
  }
}

/** A10 who can do what, and the catalogue the role form lays out — /api/v1/config/permissions. Read only. */
@Controller('config/permissions')
export class ConfigPermissionsController {
  constructor(private readonly query: RolesQuery) {}

  @Get('catalogue')
  @RequirePermission(P.VIEW)
  catalogue() {
    return this.query.catalogueTree();
  }

  @Get('user/:id')
  @RequirePermission(P.VIEW)
  person(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.person(ctx, id);
  }

  @Get('compare')
  @RequirePermission(P.VIEW)
  compare(@CurrentContext() ctx: RequestContext, @Query() q: CompareRolesQueryDto) {
    return this.query.compare(ctx, q.a, q.b);
  }
}
