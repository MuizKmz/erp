import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { NotFoundError } from '../../platform/http/errors';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { ReferenceEntryDto, ReferenceVersionDto, UpdateReferenceEntryDto } from './dto/reference.dto';
import { ReferenceQuery } from './reference.query';
import { REFERENCE_LISTS, type ReferenceList } from './reference.rules';
import { ReferenceService } from './reference.service';

function listOf(segment: string): ReferenceList {
  if (!(REFERENCE_LISTS as readonly string[]).includes(segment)) throw new NotFoundError(`Reference list "${segment}"`);
  return segment as ReferenceList;
}

/** C12 reference lists — /api/v1/core/reference/:list (item-groups, customer-categories, areas, credit-terms). */
@Controller('core/reference')
export class CoreReferenceController {
  constructor(
    private readonly query: ReferenceQuery,
    private readonly reference: ReferenceService,
  ) {}

  @Get()
  @RequirePermission(P.VIEW)
  lists(@CurrentContext() ctx: RequestContext) {
    return this.query.lists(ctx);
  }

  @Post(':list')
  @RequirePermission(P.REFERENCE_EDIT)
  create(@CurrentContext() ctx: RequestContext, @Param('list') list: string, @Body() dto: ReferenceEntryDto) {
    return this.reference.create(ctx, listOf(list), dto);
  }

  @Patch(':list/:id')
  @RequirePermission(P.REFERENCE_EDIT)
  update(@CurrentContext() ctx: RequestContext, @Param('list') list: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReferenceEntryDto) {
    return this.reference.update(ctx, listOf(list), id, dto);
  }

  @Delete(':list/:id')
  @RequirePermission(P.REFERENCE_EDIT)
  remove(@CurrentContext() ctx: RequestContext, @Param('list') list: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: ReferenceVersionDto) {
    return this.reference.remove(ctx, listOf(list), id, q.version);
  }
}
