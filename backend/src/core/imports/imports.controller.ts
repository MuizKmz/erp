import { Body, Controller, Get, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsIn } from 'class-validator';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { CORE_PERMISSIONS as P } from '../core.permissions';
import { IMPORT_KINDS, type ImportKind } from './imports.rules';
import { ImportsService, type ImportFile } from './imports.service';

export class ImportKindDto {
  @IsIn(IMPORT_KINDS, { message: 'Pick what to import: customers, suppliers, items or price-list prices.' })
  kind!: ImportKind;
}

/** Larger than the 2 MB a file may be, so the service can say so in words. */
const upload = FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } });

/** C14 import — /api/v1/core/imports. Multipart with "file" and "kind". Check saves nothing; Load saves the rows that pass. */
@Controller('core/imports')
export class CoreImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('kinds')
  @RequirePermission(P.VIEW)
  kinds() {
    return { kinds: this.imports.kinds() };
  }

  @Post('check')
  @RequirePermission(P.IMPORT)
  @UseInterceptors(upload)
  check(@CurrentContext() ctx: RequestContext, @UploadedFile() file: ImportFile | undefined, @Body() dto: ImportKindDto) {
    return this.imports.check(ctx, dto.kind, file);
  }

  @Post('load')
  @RequirePermission(P.IMPORT)
  @UseInterceptors(upload)
  load(@CurrentContext() ctx: RequestContext, @UploadedFile() file: ImportFile | undefined, @Body() dto: ImportKindDto) {
    return this.imports.load(ctx, dto.kind, file);
  }
}
