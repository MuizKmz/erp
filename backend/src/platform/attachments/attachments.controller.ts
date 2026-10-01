import { Body, Controller, Get, Param, ParseUUIDPipe, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CurrentContext } from '../context/context.decorators';
import type { RequestContext } from '../context/request-context';
import { AttachmentsService, type UploadedFileData } from './attachments.service';

const CODE = /^[A-Z][A-Z0-9_]*$/;

export class UploadAttachmentDto {
  /** RECEIPT_PHOTO, SUPPLIER_LETTER, DO_PHOTO … */
  @IsOptional()
  @Matches(CODE, { message: 'Kind must be an upper-case code like RECEIPT_PHOTO.' })
  @MaxLength(40)
  kind?: string;

  @IsOptional()
  @IsString()
  @Matches(CODE, { message: 'Entity type must be an upper-case code like PUR_ORDER.' })
  @MaxLength(40)
  entityType?: string;

  @IsOptional()
  @IsUUID('all', { message: 'Entity id must be a document id.' })
  entityId?: string;
}

/** Upload: multipart/form-data with field "file". Download streams the file back with its original name. */
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentContext() ctx: RequestContext,
    @UploadedFile() file: UploadedFileData | undefined,
    @Body() body: UploadAttachmentDto,
  ) {
    return this.attachments.upload(ctx, file, body);
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.get(ctx.tenantId, id);
  }

  @Get(':id/download')
  async download(@CurrentContext() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const file = await this.attachments.openForDownload(ctx.tenantId, id);
    return new StreamableFile(file.stream, {
      type: file.mimeType,
      length: file.size,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }
}
