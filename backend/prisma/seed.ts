/**
 * Seeds docs/design/SEED_DATA.md: "today" in the demo is Tuesday 29 Sep 2026.
 *
 *   npx prisma db seed
 *
 * Safe to run again. Master data is upserted on business codes. Purchase documents, settings and the
 * platform records around them (approvals, activity, links, emails, outbox, attachments) are DELETED and
 * recreated, so the demo always starts from the same state. Do not run it on data you want to keep.
 *
 * After seeding, verify.ts recomputes the numbers the mockups show and the seed fails if one is off.
 */
import { rm } from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedBuyingDocuments } from './seed/documents-buy';
import { seedCorrectionDocuments } from './seed/documents-fix';
import { seedReceivingDocuments } from './seed/documents-receive';
import { seedMasterData } from './seed/master-data';
import { seedAttachments, seedRecords } from './seed/records';
import { seedSettings } from './seed/settings';
import { TENANT_ID, type SeedCtx } from './seed/util';
import { verifySeed } from './seed/verify';

const prisma = new PrismaClient();
const uploadRoot = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

/** Removes the demo documents and everything that hangs off them, children first. */
async function resetDemoData(tenantId: string): Promise<void> {
  const where = { tenantId };
  // Uploaded files of this tenant (seeded placeholders and anything uploaded while testing).
  await rm(path.join(uploadRoot, tenantId), { recursive: true, force: true });

  await prisma.$transaction([
    prisma.sysAttachment.deleteMany({ where }),
    prisma.sysEventHandled.deleteMany({ where }),
    prisma.sysOutbox.deleteMany({ where }),
    prisma.sysActivity.deleteMany({ where }),
    prisma.sysApprovalRequest.deleteMany({ where }), // steps cascade
    prisma.sysDocLink.deleteMany({ where }),
    prisma.sysEmailLog.deleteMany({ where }),

    prisma.purDebitNote.deleteMany({ where }), // lines cascade
    prisma.purReturn.deleteMany({ where }),
    prisma.purInvoice.deleteMany({ where }),
    prisma.purCancelOrder.deleteMany({ where }),
    prisma.purGoodsReceipt.deleteMany({ where }),
    prisma.purPurchaseOrder.deleteMany({ where }),
    prisma.purRfq.deleteMany({ where }),
    prisma.purRequest.deleteMany({ where }),
    prisma.purCashPurchase.deleteMany({ where }),

    prisma.purApprovalRule.deleteMany({ where }),
    prisma.purSetting.deleteMany({ where }),
    prisma.purSettingChange.deleteMany({ where }),
    prisma.purPoType.deleteMany({ where }),
    prisma.purPaymentMethod.deleteMany({ where }),
    prisma.purEmailTemplate.deleteMany({ where }),
    prisma.purPriceHistory.deleteMany({ where }),
    prisma.purSupplierStat.deleteMany({ where }),
  ]);
}

async function printCounts(): Promise<void> {
  const tables: Record<string, () => Promise<number>> = {
    sys_tenant: () => prisma.sysTenant.count(),
    sys_number_sequence: () => prisma.sysNumberSequence.count(),
    sys_activity: () => prisma.sysActivity.count(),
    sys_approval_request: () => prisma.sysApprovalRequest.count(),
    sys_approval_step: () => prisma.sysApprovalStep.count(),
    sys_outbox: () => prisma.sysOutbox.count(),
    sys_attachment: () => prisma.sysAttachment.count(),
    sys_doc_link: () => prisma.sysDocLink.count(),
    sys_email_log: () => prisma.sysEmailLog.count(),
    mdm_branch: () => prisma.mdmBranch.count(),
    mdm_user: () => prisma.mdmUser.count(),
    mdm_warehouse: () => prisma.mdmWarehouse.count(),
    mdm_location: () => prisma.mdmLocation.count(),
    mdm_uom: () => prisma.mdmUom.count(),
    mdm_uom_conversion: () => prisma.mdmUomConversion.count(),
    mdm_tax_code: () => prisma.mdmTaxCode.count(),
    mdm_supplier: () => prisma.mdmSupplier.count(),
    mdm_item: () => prisma.mdmItem.count(),
    mdm_contract_price: () => prisma.mdmContractPrice.count(),
    inv_stock_snapshot: () => prisma.invStockSnapshot.count(),
    sal_demand_stub: () => prisma.salDemandStub.count(),
    pur_request: () => prisma.purRequest.count(),
    pur_request_line: () => prisma.purRequestLine.count(),
    pur_rfq: () => prisma.purRfq.count(),
    pur_rfq_supplier: () => prisma.purRfqSupplier.count(),
    pur_rfq_reply_line: () => prisma.purRfqReplyLine.count(),
    pur_purchase_order: () => prisma.purPurchaseOrder.count(),
    pur_purchase_order_line: () => prisma.purPurchaseOrderLine.count(),
    pur_goods_receipt: () => prisma.purGoodsReceipt.count(),
    pur_invoice: () => prisma.purInvoice.count(),
    pur_cancel_order: () => prisma.purCancelOrder.count(),
    pur_cash_purchase: () => prisma.purCashPurchase.count(),
    pur_debit_note: () => prisma.purDebitNote.count(),
    pur_return: () => prisma.purReturn.count(),
    pur_approval_rule: () => prisma.purApprovalRule.count(),
    pur_email_template: () => prisma.purEmailTemplate.count(),
    pur_price_history: () => prisma.purPriceHistory.count(),
  };
  const counts: Record<string, number> = {};
  for (const [name, count] of Object.entries(tables)) counts[name] = await count();
  console.log('\nRow counts');
  console.table(counts);
}

async function main(): Promise<void> {
  const tenant = await prisma.sysTenant.upsert({
    where: { code: 'CLB' },
    update: { name: 'CLB Groups' },
    create: { id: TENANT_ID, code: 'CLB', name: 'CLB Groups', baseCurrency: 'MYR', timezone: 'Asia/Kuala_Lumpur' },
  });

  const ctx: SeedCtx = {
    prisma,
    tenantId: tenant.id,
    users: new Map(),
    items: new Map(),
    suppliers: new Map(),
    taxes: new Map(),
    warehouses: new Map(),
    docs: new Map(),
  };

  await resetDemoData(tenant.id);
  await seedMasterData(ctx);
  await seedSettings(ctx);
  await seedBuyingDocuments(ctx);
  await seedReceivingDocuments(ctx);
  await seedCorrectionDocuments(ctx);
  await seedRecords(ctx);
  await seedAttachments(ctx, uploadRoot);

  await printCounts();

  const checks = await verifySeed(ctx, uploadRoot);
  console.log('\nChecks against the mockups');
  console.table(checks.map((c) => ({ ok: c.ok ? '✓' : '✗', check: c.check, expected: c.expected, actual: c.actual })));
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    throw new Error(`${failed.length} seed check(s) failed: ${failed.map((c) => c.check).join('; ')}`);
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
