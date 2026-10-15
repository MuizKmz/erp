import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { CreateBranchDto, CreateCompanyDto, OrganisationVersionDto, UpdateBranchDto, UpdateCompanyDto } from './dto/organisation.dto';
import { OrganisationQuery } from './organisation.query';
import { OrganisationService } from './organisation.service';

/** A04 · Company — /api/v1/config/companies */
@Controller('config/companies')
export class ConfigCompaniesController {
  constructor(
    private readonly query: OrganisationQuery,
    private readonly service: OrganisationService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.companies(ctx);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.company(ctx, id);
  }

  @Post()
  @RequirePermission(P.ORGANISATION_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateCompanyDto) {
    return this.service.createCompany(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission(P.ORGANISATION_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.service.updateCompany(ctx, id, dto);
  }

  @Post(':id/deactivate')
  @RequirePermission(P.ORGANISATION_EDIT)
  deactivate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrganisationVersionDto) {
    return this.service.setCompanyActive(ctx, id, false, dto.version);
  }

  @Post(':id/activate')
  @RequirePermission(P.ORGANISATION_EDIT)
  activate(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrganisationVersionDto) {
    return this.service.setCompanyActive(ctx, id, true, dto.version);
  }
}

/** A05 · Branches — /api/v1/config/branches. The Active switch is part of the form, so a save can make one inactive. */
@Controller('config/branches')
export class ConfigBranchesController {
  constructor(
    private readonly query: OrganisationQuery,
    private readonly service: OrganisationService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  list(@CurrentContext() ctx: RequestContext) {
    return this.query.branches(ctx);
  }

  @Get(':id')
  @RequirePermission(P.VIEW)
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.branch(ctx, id);
  }

  @Post()
  @RequirePermission(P.ORGANISATION_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Body() dto: CreateBranchDto) {
    return this.service.createBranch(ctx, dto);
  }

  @Patch(':id')
  @RequirePermission(P.ORGANISATION_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.service.updateBranch(ctx, id, dto);
  }
}
