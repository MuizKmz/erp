import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { SysAttachment } from '@prisma/client';
import type { Env } from '../../config/env';
import type { RequestContext } from '../context/request-context';
import { BusinessRuleError, NotFoundError, ValidationFailedError } from '../http/errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { checkUpload, cleanFileName, storageExtension } from './attachments.rules';

/** The part of a multer file we use (memory storage). */
export interface UploadedFileData {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: string | null;
  entityType: string | null;
  entityId: string | null;
  uploadedByCode: string;
  createdAt: string;
  downloadUrl: string;
}

function toView(row: SysAttachment): AttachmentView {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    kind: row.kind,
    entityType: row.entityType,
    entityId: row.entityId,
    uploadedByCode: row.uploadedByCode,
    createdAt: row.createdAt.toISOString(),
    downloadUrl: `/attachments/${row.id}/download`,
  };
}

/**
 * Local file storage under backend/uploads/<tenant>/<yyyy>/<mm>/<id>.<ext>.
 * Files are uploaded first (the form shows them at once), then attached to the document when it is saved.
 * Files are never served directly from disk; downloads go through the API so access can be checked.
 */
@Injectable()
export class AttachmentsService {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    // backend/ is three levels up from src/platform/attachments (and from dist/platform/attachments).
    const backendDir = path.resolve(__dirname, '..', '..', '..');
    this.root = path.resolve(backendDir, config.get('UPLOAD_DIR', { infer: true }));
    this.maxBytes = config.get('UPLOAD_MAX_BYTES', { infer: true });
  }

  async upload(
    ctx: RequestContext,
    file: UploadedFileData | undefined,
    meta: { kind?: string; entityType?: string; entityId?: string } = {},
  ): Promise<AttachmentView> {
    if (!file) throw ValidationFailedError.field('file', 'Choose a file to upload.');
    const problem = checkUpload({ fileName: file.originalname, mimeType: file.mimetype, size: file.size }, this.maxBytes);
    if (problem) throw ValidationFailedError.field('file', problem);

    const id = randomUUID();
    const now = new Date();
    const storageKey = [
      ctx.tenantId,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}${storageExtension(file.mimetype)}`,
    ].join('/');
    const absolute = this.absolutePath(storageKey);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, file.buffer);
    try {
      const row = await this.prisma.sysAttachment.create({
        data: {
          id,
          tenantId: ctx.tenantId,
          entityType: meta.entityType ?? null,
          entityId: meta.entityId ?? null,
          kind: meta.kind ?? null,
          fileName: cleanFileName(file.originalname),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          uploadedByCode: ctx.user.code,
        },
      });
      return toView(row);
    } catch (err) {
      await unlink(absolute).catch(() => undefined); // do not leave an orphan file behind; the DB error still surfaces
      throw err;
    }
  }

  /** Links uploaded files to a document, in the document's save transaction. */
  async attach(tx: Tx, ctx: RequestContext, ids: string[], entityType: string, entityId: string): Promise<void> {
    if (ids.length === 0) return;
    const result = await tx.sysAttachment.updateMany({
      where: {
        tenantId: ctx.tenantId,
        id: { in: ids },
        OR: [{ entityId: null }, { entityType, entityId }],
      },
      data: { entityType, entityId },
    });
    if (result.count !== new Set(ids).size) {
      throw new BusinessRuleError('ATTACHMENT_NOT_AVAILABLE', 'One of the files is missing or belongs to another document.');
    }
  }

  async listFor(tenantId: string, entityType: string, entityId: string): Promise<AttachmentView[]> {
    const rows = await this.prisma.sysAttachment.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<AttachmentView> {
    return toView(await this.find(tenantId, id));
  }

  async openForDownload(
    tenantId: string,
    id: string,
  ): Promise<{ stream: ReadStream; fileName: string; mimeType: string; size: number }> {
    const row = await this.find(tenantId, id);
    const absolute = this.absolutePath(row.storageKey);
    const info = await stat(absolute).catch(() => null);
    if (!info) throw new NotFoundError('File');
    return { stream: createReadStream(absolute), fileName: row.fileName, mimeType: row.mimeType, size: info.size };
  }

  private async find(tenantId: string, id: string): Promise<SysAttachment> {
    const row = await this.prisma.sysAttachment.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundError('File');
    return row;
  }

  /** Resolves a storage key and refuses anything that would land outside the upload folder. */
  private absolutePath(storageKey: string): string {
    const absolute = path.resolve(this.root, storageKey);
    if (!absolute.startsWith(this.root + path.sep)) {
      throw new Error(`Storage key escapes the upload folder: ${storageKey}`);
    }
    return absolute;
  }
}
