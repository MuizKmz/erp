import { Injectable } from '@nestjs/common';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { PermissionDeniedError, ValidationFailedError } from '../../platform/http/errors';
import { formatDocNo } from '../../platform/numbering/numbering.rules';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { IMPORT_KIND_DEFINITIONS } from './import-kinds';
import { CustomerImporter } from './importers/customer.importer';
import { problemOf, type Importer, type PlannedRow } from './importers/importer';
import { ItemImporter } from './importers/item.importer';
import { PriceImporter } from './importers/price.importer';
import { SupplierImporter } from './importers/supplier.importer';
import { checkSummary, loadSummary, matchColumns, MAX_BYTES, MAX_ROWS, parseCsv, type ImportKind } from './imports.rules';

export interface ImportFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

/**
 * C14 · Import from CSV (CLAUDE.md → Phase 3 · decision 10, rule 12). Check reads the file and saves nothing. Load
 * checks it again and saves each row that passes on its own, through the same services as the screens, so one row
 * never stops the others (SRS BR-STA-005, DR-005, INT-013, BR-VAL-020). Rows with a problem come back for a CSV.
 */
@Injectable()
export class ImportsService {
  private readonly importers: Record<ImportKind, Importer>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionRegistry,
    customers: CustomerImporter,
    suppliers: SupplierImporter,
    items: ItemImporter,
    prices: PriceImporter,
  ) {
    this.importers = { customers, suppliers, items, prices };
  }

  /** What can be imported, with the template's columns and the Check table's columns. */
  kinds() {
    return Object.values(IMPORT_KIND_DEFINITIONS).map((d) => ({ kind: d.kind, label: d.label, columns: d.columns.map((c) => c.header), display: d.display, note: d.note }));
  }

  async check(ctx: RequestContext, kind: ImportKind, file: ImportFile | undefined) {
    const read = await this.plan(ctx, kind, file);
    const counts = { ready: 0, unchanged: 0, problem: 0 };
    for (const p of read.planned) counts[p.status === 'problem' ? 'problem' : p.status === 'unchanged' ? 'unchanged' : 'ready']++;
    await this.previewCodes(ctx, read.importer, read.planned);
    return { ...this.answer(kind, file!, read), counts, summary: checkSummary(counts) };
  }

  async load(ctx: RequestContext, kind: ImportKind, file: ImportFile | undefined) {
    const read = await this.plan(ctx, kind, file);
    const counts = { added: 0, updated: 0, unchanged: 0, problem: 0 };
    const statuses: string[] = [];
    for (const p of read.planned) {
      let status: keyof typeof counts = p.status === 'problem' ? 'problem' : 'unchanged';
      if (p.status === 'new' || p.status === 'update') {
        try {
          const code = await p.apply!();
          if (p.status === 'new') {
            status = 'added';
            p.result = read.importer.numbering || kind === 'items' ? `Added ${code}` : 'Added';
            if (read.importer.numbering) p.display = { ...p.display, code };
            p.code = code;
          } else {
            status = 'updated';
            p.result = p.result.replace(/^Update:/, 'Updated:');
          }
        } catch (error) {
          p.status = 'problem';
          p.result = problemOf(error);
        }
      }
      counts[status]++;
      statuses.push(status);
    }
    if (read.importer.numbering) for (const p of read.planned) if (!p.code) p.display = { ...p.display, code: 'New' };
    return { ...this.answer(kind, file!, read, statuses), counts, summary: loadSummary(counts) };
  }

  /** Reads and checks the file; every row is planned against Core's records as they are now. */
  private async plan(ctx: RequestContext, kind: ImportKind, file: ImportFile | undefined) {
    const def = IMPORT_KIND_DEFINITIONS[kind];
    const importer = this.importers[kind];
    if (!this.permissions.has(ctx.user.roles, importer.permission)) throw new PermissionDeniedError(importer.permission);
    if (!file) throw ValidationFailedError.field('file', 'Upload a CSV file.');
    if (!/\.csv$/i.test(file.originalname)) throw ValidationFailedError.field('file', 'Upload a CSV file (.csv). In Excel, use Save As and pick CSV UTF-8.');
    if (file.size > MAX_BYTES) throw ValidationFailedError.field('file', 'The file is larger than 2 MB. Split it into smaller files.');
    const table = parseCsv(file.buffer.toString('utf8'));
    const [headers = [], ...lines] = table;
    if (!lines.length) throw ValidationFailedError.field('file', 'The file has no rows under the header.');
    if (lines.length > MAX_ROWS) throw ValidationFailedError.field('file', `The file has ${lines.length.toLocaleString('en-MY')} rows. Load at most ${MAX_ROWS.toLocaleString('en-MY')} at a time.`);
    const { index, unused, missing } = matchColumns(headers, def.columns, def.required);
    if (!index.size) throw ValidationFailedError.field('file', `None of the columns are ones a ${def.label.toLowerCase()} import reads. Download the template to see them.`);
    if (missing.length) throw ValidationFailedError.field('file', `The file has no ${missing.join(', ')} column. Download the template to see the columns.`);
    const rows = lines.map((cells) => Object.fromEntries(def.columns.map((c) => [c.key, index.has(c.key) ? (cells[index.get(c.key)!] ?? '') : ''])));
    const planned = await importer.plan(ctx, rows);
    const notices = unused.length ? [`Columns a ${def.label.toLowerCase()} import does not read are left out: ${unused.join(', ')}.`] : [];
    return { def, importer, headers, lines, planned, notices };
  }

  /** A ready new party shows the number it would get: "New · C-0103". Nothing is reserved; Load takes the real one. */
  private async previewCodes(ctx: RequestContext, importer: Importer, planned: PlannedRow[]): Promise<void> {
    if (!importer.numbering) return;
    const seq = await this.prisma.sysNumberSequence.findUnique({ where: { tenantId_docType: { tenantId: ctx.tenantId, docType: importer.numbering } } });
    let next = seq ? Number(seq.nextValue) : null;
    for (const p of planned) {
      if (p.code) continue;
      p.display = { ...p.display, code: p.status === 'new' && seq && next !== null ? `New · ${formatDocNo(seq.prefix, Number(seq.digits), next++)}` : 'New' };
    }
  }

  /** The rows as C14 shows them; after Load, each row's status is what Load did (added, updated, unchanged, problem). */
  private answer(kind: ImportKind, file: ImportFile, read: Awaited<ReturnType<ImportsService['plan']>>, statuses?: string[]) {
    const rows = read.planned.map((p, i) => ({ row: i + 1, status: statuses?.[i] ?? p.status, code: p.code, display: p.display, result: p.result }));
    return {
      kind,
      fileName: file.originalname,
      columns: read.def.display,
      rows,
      notices: read.notices,
      // "Download rows with problems": the rows as they were in the file, with the problem in a last column.
      problems: {
        headers: [...read.headers, 'Problem'],
        rows: read.planned.flatMap((p, i) => (p.status === 'problem' ? [[...read.headers.map((_, c) => read.lines[i]![c] ?? ''), p.result]] : [])),
      },
    };
  }
}
