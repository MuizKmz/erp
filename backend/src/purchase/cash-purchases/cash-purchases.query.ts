import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PurCashPurchase, PurCashPurchaseLine } from '@prisma/client';
import { STOCK_PORT, type StockPort } from '../../integration/integration.ports';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ActivityService } from '../../platform/activity/activity.service';
import { AttachmentsService } from '../../platform/attachments/attachments.service';
import { ClockService } from '../../platform/clock/clock.service';
import { PermissionRegistry } from '../../platform/context/permission.registry';
import type { RequestContext } from '../../platform/context/request-context';
import { dec, toMoney, toPrice, toQty } from '../../platform/http/decimal';
import { NotFoundError } from '../../platform/http/errors';
import { buildStatusCounts, dateRange, pageArgs, parseSort, statusFromKey, toListResponse, toOrderBy } from '../../platform/http/list';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { PURCHASE_PERMISSIONS as P } from '../purchase.permissions';
import { PurchaseSettingsService } from '../shared/purchase-settings.service';
import { PUR_ENTITY } from '../shared/purchase.constants';
import type { CashPurchaseListQueryDto } from './dto/cash-purchase.dto';
import { allowedCashPurchaseActions, cashChecks, type CashPurchaseStatus } from './cash-purchase.rules';

export const CASH_PURCHASE_STATUSES = ['DRAFT', 'RELEASED'] as const;
export type CashPurchaseWithLines = PurCashPurchase & { lines: PurCashPurchaseLine[] };

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const sum = (values: Prisma.Decimal[]) => values.reduce((s, v) => s.add(v), dec(0));

/** Reading cash purchases: the list with monthly totals (P18) and one purchase with its checks (P19). */
@Injectable()
export class CashPurchasesQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly attachments: AttachmentsService,
    private readonly permissions: PermissionRegistry,
    private readonly clock: ClockService,
    private readonly settings: PurchaseSettingsService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    @Inject(STOCK_PORT) private readonly stock: StockPort,
  ) {}

  async load(tenantId: string, id: string): Promise<CashPurchaseWithLines> {
    const row = await this.prisma.purCashPurchase.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { lineNo: 'asc' } } } });
    if (!row) throw new NotFoundError('Cash purchase');
    return row;
  }

  actions(ctx: RequestContext, row: Pick<PurCashPurchase, 'status' | 'isMigrated'>) {
    return allowedCashPurchaseActions({
      status: row.status as CashPurchaseStatus,
      isMigrated: row.isMigrated,
      canEdit: this.permissions.has(ctx.user.roles, P.CASH_PURCHASE_EDIT),
      canRelease: this.permissions.has(ctx.user.roles, P.CASH_PURCHASE_RELEASE),
    });
  }

  /** Company cards and petty cash floats of the branches the user works in. */
  paymentMethods(ctx: RequestContext) {
    return this.prisma.purPaymentMethod.findMany({ where: { tenantId: ctx.tenantId, isActive: true, branchCode: { in: ctx.user.branchCodes } }, orderBy: { code: 'asc' } });
  }

  async photoCount(tenantId: string, id: string) {
    return this.prisma.sysAttachment.count({ where: { tenantId, entityType: PUR_ENTITY.CASH_PURCHASE, entityId: id, mimeType: { startsWith: 'image/' } } });
  }

  // ── List (P18) ────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: CashPurchaseListQueryDto) {
    const sort = parseSort(query.sort, { docNo: 'docNo', docDate: 'docDate', total: 'total' }, '-docDate');
    const docDate = dateRange(query);
    const q = query.q?.trim();
    const base: Prisma.PurCashPurchaseWhereInput = {
      tenantId: ctx.tenantId,
      ...(docDate && { docDate }),
      ...(query.supplier?.trim() && { supplierName: { contains: query.supplier.trim() } }),
      ...(query.paidBy && { paymentMethodCode: query.paidBy }),
      ...(query.branch && { branchCode: query.branch }),
      ...(q && { OR: [{ docNo: { contains: q } }, { summary: { contains: q } }, { receiptNo: { contains: q } }] }),
    };
    const status = statusFromKey(query.status, CASH_PURCHASE_STATUSES);
    const where: Prisma.PurCashPurchaseWhereInput = { ...base, ...(status && { status }) };
    const [rows, total, grouped] = await Promise.all([
      this.prisma.purCashPurchase.findMany({ where, orderBy: [toOrderBy(sort), { docNo: sort.direction }], ...pageArgs(query) }),
      this.prisma.purCashPurchase.count({ where }),
      this.prisma.purCashPurchase.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const photos = await this.prisma.sysAttachment.groupBy({
      by: ['entityId'],
      where: { tenantId: ctx.tenantId, entityType: PUR_ENTITY.CASH_PURCHASE, entityId: { in: rows.map((r) => r.id) }, mimeType: { startsWith: 'image/' } },
      _count: { _all: true },
    });
    return toListResponse(
      rows.map((r) => ({
        id: r.id,
        docNo: r.docNo,
        docDate: isoDate(r.docDate),
        supplierName: r.supplierName,
        summary: r.summary,
        paidByLabel: r.paidByLabel,
        boughtByName: r.boughtByName,
        total: toMoney(r.total),
        receipt: r.isMigrated ? 'OLD_SYSTEM' : photos.some((p) => p.entityId === r.id) ? 'PHOTO' : 'MISSING',
        status: r.status,
        isMigrated: r.isMigrated,
      })),
      total,
      query,
      buildStatusCounts(grouped, CASH_PURCHASE_STATUSES),
    );
  }

  /** "September by payment method" and the petty cash floats. */
  async overview(ctx: RequestContext) {
    const today = this.clock.today();
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
    const [methods, month, limit] = await Promise.all([
      this.paymentMethods(ctx),
      this.prisma.purCashPurchase.findMany({ where: { tenantId: ctx.tenantId, docDate: { gte: monthStart }, branchCode: { in: ctx.user.branchCodes } }, select: { paymentMethodCode: true, total: true } }),
      this.settings.cashLimit(ctx.tenantId),
    ]);
    const spent = (code: string) => sum(month.filter((m) => m.paymentMethodCode === code).map((m) => m.total));
    const monthTotal = sum(month.map((m) => m.total));
    return {
      month: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(monthStart),
      count: month.length,
      total: toMoney(monthTotal),
      byMethod: methods
        .map((m) => ({ code: m.code, label: m.label, total: toMoney(spent(m.code)) }))
        .filter((m) => dec(m.total).gt(0)),
      floats: methods
        .filter((m) => m.kind === 'PETTY_CASH' && m.floatAmount)
        .map((m) => ({ code: m.code, label: m.label, branchCode: m.branchCode, float: toMoney(m.floatAmount!), spent: toMoney(spent(m.code)), left: toMoney(m.floatAmount!.sub(spent(m.code))) })),
      limit,
    };
  }

  // ── One cash purchase (P19) ───────────────────────────────────────────────

  async detail(ctx: RequestContext, id: string) {
    const row = await this.load(ctx.tenantId, id);
    const codes = row.lines.map((l) => l.itemCode);
    const [activity, files, supplier, method, branches, items, stock, users] = await Promise.all([
      this.activity.listFor(ctx.tenantId, PUR_ENTITY.CASH_PURCHASE, row.id),
      this.attachments.listFor(ctx.tenantId, PUR_ENTITY.CASH_PURCHASE, row.id),
      this.masterData.findSupplier(ctx.tenantId, row.supplierCode),
      this.prisma.purPaymentMethod.findFirst({ where: { tenantId: ctx.tenantId, code: row.paymentMethodCode } }),
      this.masterData.listBranches(ctx.tenantId),
      this.masterData.findItems(ctx.tenantId, codes),
      this.stock.listStock(ctx.tenantId, codes),
      this.masterData.listUsers(ctx.tenantId),
    ]);
    const [taxes, limit] = await Promise.all([this.masterData.listTaxCodes(ctx.tenantId), this.settings.cashLimit(ctx.tenantId)]);
    const taxName = (code: string) => taxes.find((t) => t.code === code)?.name ?? code;
    const first = row.lines[0];
    const firstItem = first ? items.find((i) => i.code === first.itemCode) : null;
    const onHand = first ? sum(stock.filter((s) => s.itemCode === first.itemCode && s.warehouseCode === row.warehouseCode).map((s) => dec(s.onHand))) : null;
    return {
      id: row.id,
      docNo: row.docNo,
      docDate: isoDate(row.docDate),
      status: row.status,
      isMigrated: row.isMigrated,
      version: row.version,
      supplier: { code: row.supplierCode, name: row.supplierName },
      boughtBy: { code: row.boughtByCode, name: row.boughtByName, title: users.find((u) => u.code === row.boughtByCode)?.jobTitle ?? null },
      branch: { code: row.branchCode, name: branches.find((b) => b.code === row.branchCode)?.name ?? row.branchCode },
      paymentMethodCode: row.paymentMethodCode,
      paidByLabel: row.paidByLabel,
      paidBy: row.paidBy,
      receiptNo: row.receiptNo,
      currency: row.currency,
      taxMode: row.taxMode,
      summary: row.summary,
      subtotal: toMoney(row.subtotal),
      taxLines: [...new Set(row.lines.map((l) => l.taxCode))].map((code) => ({ code, name: taxName(code), amount: toMoney(sum(row.lines.filter((l) => l.taxCode === code).map((l) => l.taxAmount))) })),
      total: toMoney(row.total),
      remarks: row.remarks,
      releasedAt: row.releasedAt?.toISOString() ?? null,
      lines: row.lines.map((l) => ({
        id: l.id,
        itemCode: l.itemCode,
        itemName: l.itemName,
        uomCode: l.uomCode,
        taxCode: l.taxCode,
        taxName: taxName(l.taxCode),
        taxRate: l.taxRate.toFixed(4),
        qty: toQty(l.qty),
        unitPrice: toPrice(l.unitPrice),
        amount: toMoney(l.amount),
        taxAmount: toMoney(l.taxAmount),
      })),
      checks: cashChecks({
        limit,
        total: row.total,
        hasPhoto: row.isMigrated || files.some((f) => f.mimeType.startsWith('image/')),
        supplierActive: supplier?.status === 'ACTIVE',
        supplierName: row.supplierName,
        payment: method ? { label: method.label, active: method.isActive, branchCode: method.branchCode, holder: method.holder } : null,
        branchCode: row.branchCode,
      }),
      stock: first && firstItem
        ? {
            itemCode: first.itemCode,
            uomCode: first.uomCode,
            onHand: toQty(onHand!),
            after: toQty(row.status === 'DRAFT' ? onHand!.add(first.qty) : onHand!),
            reorderLevel: firstItem.reorderLevel,
          }
        : null,
      attachments: files.map((f) => ({ id: f.id, fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, downloadUrl: f.downloadUrl })),
      inventoryConnected: this.stock.connected,
      activity,
      allowedActions: this.actions(ctx, row),
    };
  }
}
