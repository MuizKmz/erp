/**
 * Seeds docs/design/SEED_DATA.md (Purchase), SALES_SEED_DATA.md (Sales), CORE_SEED_DATA.md (Core) and CONFIG_SEED_DATA.md
 * (Configuration): "today" in the demo is Tuesday 29 Sep 2026.
 *
 *   npx prisma db seed
 *
 * Safe to run again. Master data, users, branches and roles are upserted on business codes. Purchase documents, settings and the
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
import { seedPurchaseSalesDemand } from './seed/event-history';
import { seedReceivingDocuments } from './seed/documents-receive';
import { seedMasterData } from './seed/master-data';
import { seedSalesAttachments, seedSalesDocuments } from './seed/sales-documents';
import { seedSalesMasterData } from './seed/sales-master';
import { seedSalesSettings } from './seed/sales-settings';
import { verifySalesSeed } from './seed/sales-verify';
import { verifyConfigSeed } from './seed/config-verify';
import { seedConfiguration } from './seed/configuration';
import { seedCoreReferenceLists, seedCoreSettings } from './seed/core-settings';
import { verifyCoreSeed } from './seed/core-verify';
import { seedAttachments, seedRecords } from './seed/records';
import { seedSettings } from './seed/settings';
import { TENANT_ID, type SeedCtx } from './seed/util';
import { verifySeed } from './seed/verify';

const prisma = new PrismaClient();
const uploadRoot = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');

/** Removes the demo documents and everything that hangs off them, children first. */
async function resetDemoData(tenantId: string): Promise<void> {
  const where = { tenantId };
  const madeInCore = { tenantId, createdBy: { not: null } };
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
    // Sign-in records: nobody has signed in yet in the demo.
    prisma.sysSession.deleteMany({ where }),
    prisma.sysLoginAttempt.deleteMany({ where }),
    prisma.sysSecurityEvent.deleteMany({ where }),
    prisma.sysAuthToken.deleteMany({ where }),

    prisma.salReturn.deleteMany({ where }), // lines cascade
    prisma.salDebitNote.deleteMany({ where }),
    prisma.salInvoice.deleteMany({ where }),
    prisma.salProforma.deleteMany({ where }),
    prisma.salCancelOrder.deleteMany({ where }),
    prisma.salDelivery.deleteMany({ where }),
    prisma.salSalesOrder.deleteMany({ where }),
    prisma.salQuotation.deleteMany({ where }),
    prisma.salEnquiry.deleteMany({ where }),
    prisma.salCashSale.deleteMany({ where }),
    prisma.salSetting.deleteMany({ where }),
    prisma.salCreditRule.deleteMany({ where }),
    prisma.salSettingChange.deleteMany({ where }),
    prisma.salOrderType.deleteMany({ where }),
    prisma.salEnquiryType.deleteMany({ where }),
    prisma.salEnquirySource.deleteMany({ where }),
    prisma.salExcludedItem.deleteMany({ where }),
    prisma.salEmailTemplate.deleteMany({ where }),
    prisma.finReceiptStub.deleteMany({ where }),

    prisma.purSalesDemand.deleteMany({ where }),
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

    // Master data made in Core while testing. Seeded rows have no createdBy and are reset by their upserts below.
    prisma.mdmLocation.deleteMany({ where: madeInCore }),
    prisma.mdmWarehouse.deleteMany({ where: madeInCore }),
    prisma.mdmPriceList.deleteMany({ where: madeInCore }),
    prisma.mdmItem.deleteMany({ where: madeInCore }),
    prisma.mdmCustomer.deleteMany({ where: madeInCore }),
    prisma.mdmSupplier.deleteMany({ where: madeInCore }),
    prisma.mdmTaxCode.deleteMany({ where: madeInCore }),
    prisma.mdmUom.deleteMany({ where: madeInCore }),
    prisma.mdmItemGroup.deleteMany({ where: madeInCore }),
    prisma.mdmCustomerCategory.deleteMany({ where: madeInCore }),
    prisma.mdmArea.deleteMany({ where: madeInCore }),
    prisma.mdmCreditTerm.deleteMany({ where: madeInCore }),
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
    sys_legal_entity: () => prisma.sysLegalEntity.count(),
    sys_branch: () => prisma.sysBranch.count(),
    sys_user: () => prisma.sysUser.count(),
    sys_role: () => prisma.sysRole.count(),
    sys_role_permission: () => prisma.sysRolePermission.count(),
    sys_user_role: () => prisma.sysUserRole.count(),
    sys_user_branch: () => prisma.sysUserBranch.count(),
    sys_setting: () => prisma.sysSetting.count(),
    mdm_warehouse: () => prisma.mdmWarehouse.count(),
    mdm_location: () => prisma.mdmLocation.count(),
    mdm_uom: () => prisma.mdmUom.count(),
    mdm_uom_conversion: () => prisma.mdmUomConversion.count(),
    mdm_tax_code: () => prisma.mdmTaxCode.count(),
    mdm_supplier: () => prisma.mdmSupplier.count(),
    mdm_item: () => prisma.mdmItem.count(),
    mdm_contract_price: () => prisma.mdmContractPrice.count(),
    inv_stock_snapshot: () => prisma.invStockSnapshot.count(),
    pur_request: () => prisma.purRequest.count(),
    pur_request_line: () => prisma.purRequestLine.count(),
    pur_rfq: () => prisma.purRfq.count(),
    pur_rfq_supplier: () => prisma.purRfqSupplier.count(),
    pur_rfq_reply_line: () => prisma.purRfqReplyLine.count(),
    pur_purchase_order: () => prisma.purPurchaseOrder.count(),
    pur_sales_demand: () => prisma.purSalesDemand.count(),
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
    mdm_customer: () => prisma.mdmCustomer.count(),
    mdm_price_list_item: () => prisma.mdmPriceListItem.count(),
    mdm_item_group: () => prisma.mdmItemGroup.count(),
    mdm_customer_category: () => prisma.mdmCustomerCategory.count(),
    mdm_area: () => prisma.mdmArea.count(),
    mdm_credit_term: () => prisma.mdmCreditTerm.count(),
    fin_receipt_stub: () => prisma.finReceiptStub.count(),
    sal_enquiry: () => prisma.salEnquiry.count(),
    sal_quotation: () => prisma.salQuotation.count(),
    sal_sales_order: () => prisma.salSalesOrder.count(),
    sal_sales_order_line: () => prisma.salSalesOrderLine.count(),
    sal_delivery: () => prisma.salDelivery.count(),
    sal_invoice: () => prisma.salInvoice.count(),
    sal_proforma: () => prisma.salProforma.count(),
    sal_cancel_order: () => prisma.salCancelOrder.count(),
    sal_cash_sale: () => prisma.salCashSale.count(),
    sal_debit_note: () => prisma.salDebitNote.count(),
    sal_return: () => prisma.salReturn.count(),
    sal_excluded_item: () => prisma.salExcludedItem.count(),
    sal_email_template: () => prisma.salEmailTemplate.count(),
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
    customers: new Map(),
    docs: new Map(),
  };

  await resetDemoData(tenant.id);
  await seedConfiguration(ctx);
  await seedMasterData(ctx);
  await seedSettings(ctx);
  await seedBuyingDocuments(ctx);
  await seedReceivingDocuments(ctx);
  await seedCorrectionDocuments(ctx);
  await seedRecords(ctx);
  await seedAttachments(ctx, uploadRoot);

  await seedSalesMasterData(ctx);
  await seedSalesSettings(ctx);
  await seedCoreSettings(ctx);
  await seedCoreReferenceLists(ctx);
  await seedSalesDocuments(ctx);
  await seedSalesAttachments(ctx, uploadRoot);
  await seedPurchaseSalesDemand(ctx);

  await printCounts();

  const checks = [...(await verifySeed(ctx, uploadRoot)), ...(await verifySalesSeed(ctx)), ...(await verifyCoreSeed(ctx)), ...(await verifyConfigSeed(ctx))];
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
