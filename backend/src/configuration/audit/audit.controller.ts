import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { AuditQuery, AuditQueryDto } from './audit.query';

/** A13 · Audit trail — /api/v1/config/audit. Read only. */
@Controller('config/audit')
export class ConfigAuditController {
  constructor(private readonly query: AuditQuery) {}

  @Get()
  @RequirePermission(P.AUDIT_VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() q: AuditQueryDto) {
    return this.query.list(ctx, q);
  }

  @Get('export')
  @RequirePermission(P.AUDIT_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-trail.csv"')
  export(@CurrentContext() ctx: RequestContext, @Query() q: AuditQueryDto) {
    return this.query.exportCsv(ctx, q);
  }

  @Get(':id')
  @RequirePermission(P.AUDIT_VIEW)
  detail(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.query.detail(ctx, id);
  }
}
