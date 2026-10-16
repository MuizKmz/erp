import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CONFIG_PERMISSIONS as P } from '../configuration.permissions';
import { SecurityLogQuery, SecurityLogQueryDto } from './security-log.query';

/** A12 · Security log — /api/v1/config/security-events. Read only: there is no route that changes or deletes a row. */
@Controller('config/security-events')
export class ConfigSecurityLogController {
  constructor(private readonly query: SecurityLogQuery) {}

  @Get()
  @RequirePermission(P.SECURITY_VIEW)
  list(@CurrentContext() ctx: RequestContext, @Query() q: SecurityLogQueryDto) {
    return this.query.list(ctx, q);
  }

  @Get('export')
  @RequirePermission(P.SECURITY_VIEW)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="security-log.csv"')
  export(@CurrentContext() ctx: RequestContext, @Query() q: SecurityLogQueryDto) {
    return this.query.exportCsv(ctx, q);
  }
}
