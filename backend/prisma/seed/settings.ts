/**
 * Purchase settings (Operation Policies P24–P26), numbering, purchase history and supplier delivery records.
 * Wording comes from PurPolicies.html, PurDocTypes.html and PurEmailTemplates.html. Template texts other
 * than "Purchase order to supplier" are invented in the same style.
 */
import { Prisma } from '@prisma/client';
import { day, kl, nameOf, type SeedCtx } from './util';

/** Next numbers after seeding (SEED_DATA.md → Numbering). */
const SEQUENCES = [
  { docType: 'PRQ', name: 'Purchase request', next: 7 },
  { docType: 'RFQ', name: 'Request for quotation', next: 5 },
  { docType: 'PO', name: 'Purchase order', next: 7 },
  { docType: 'GRN', name: 'Goods receipt', next: 4 },
  { docType: 'PI', name: 'Purchase invoice', next: 4 },
  { docType: 'CP', name: 'Cash purchase', next: 3 },
  { docType: 'PDN', name: 'Supplier debit note', next: 2 },
  { docType: 'PRT', name: 'Purchase return', next: 2 },
  { docType: 'PCO', name: 'Cancel order', next: 2 },
];

const PO_TYPES = [
  { code: 'STD', name: 'Standard', description: 'Goods for stock or use. Needs a goods receipt before the invoice.', needsGoodsReceipt: true },
  { code: 'BTO', name: 'Buy to order', description: 'Raised from a sales order line. Keeps the link to the customer order.', needsGoodsReceipt: true, linkedToSalesOrder: true },
  { code: 'SVC', name: 'Service', description: 'Repairs, installation, transport. Billed against the PO with no goods receipt.', needsGoodsReceipt: false },
  { code: 'AST', name: 'Asset', description: 'Machines and equipment. Sent to the asset register when Finance plugs in.', needsGoodsReceipt: true, sendsToAssetRegister: true },
];

export const EMAIL_TEMPLATES = [
  {
    key: 'PO_TO_SUPPLIER',
    name: 'Purchase order to supplier',
    description: 'Sent when a PO is released',
    toTemplate: '{supplier.email}',
    ccTemplate: '{buyer.email}',
    subject: 'Purchase order {po.number} from {company.name}',
    body:
      'Dear {supplier.contact},\n\nPlease find attached our purchase order {po.number} dated {po.date}.\n\n' +
      'Deliver to: {po.deliver_to}\nNeeded by: {po.expected_date}\nOrder total: {po.currency} {po.total}\n\n' +
      'Please quote {po.number} on your delivery order and invoice, and reply to confirm the delivery date.\n\n' +
      'Regards,\n{buyer.name}\n{company.name}',
    attachPdf: true,
    autoSend: true,
  },
  {
    key: 'RFQ_REQUEST',
    name: 'RFQ request',
    description: 'Asks a supplier for a price',
    toTemplate: '{supplier.email}',
    ccTemplate: null,
    subject: 'Request for quotation {rfq.number} · reply by {rfq.reply_by}',
    body:
      'Dear {supplier.contact},\n\nWe would like your best price for:\n{rfq.items}\n\n' +
      'Please reply by {rfq.reply_by} with unit price, delivery time, minimum order, payment term and validity, ' +
      'using your own reply link:\n{rfq.reply_link}\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: false,
    autoSend: true,
  },
  {
    key: 'RFQ_NOT_AWARDED',
    name: 'RFQ not awarded',
    description: 'Polite “not this time”',
    toTemplate: '{supplier.email}',
    ccTemplate: null,
    subject: 'Request for quotation {rfq.number} · thank you',
    body:
      'Dear {supplier.contact},\n\nThank you for your quotation for {rfq.number}. We have placed this order with another ' +
      'supplier this time, and we look forward to asking you again.\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: false,
    autoSend: true,
  },
  {
    key: 'DELIVERY_REMINDER',
    name: 'Delivery reminder',
    description: 'Two days before the expected date',
    toTemplate: '{supplier.email}',
    ccTemplate: '{buyer.email}',
    subject: 'Reminder: {po.number} is due on {po.expected_date}',
    body:
      'Dear {supplier.contact},\n\nThis is a reminder that {po.number} is due for delivery to {po.deliver_to} on ' +
      '{po.expected_date}. Please let us know at once if the date will change.\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: false,
    autoSend: true,
  },
  {
    key: 'INVOICE_DIFFERENCE',
    name: 'Invoice difference',
    description: 'When we record less than billed',
    toTemplate: '{supplier.email}',
    ccTemplate: '{buyer.email}',
    subject: 'Your invoice {invoice.supplier_no}: recorded {invoice.recorded_total}',
    body: 'Dear {supplier.contact},\n\n{invoice.message}\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: false,
    autoSend: false,
  },
  {
    key: 'CANCELLATION_NOTICE',
    name: 'Cancellation notice',
    description: 'When a PO balance is cancelled',
    toTemplate: '{supplier.email}',
    ccTemplate: '{buyer.email}',
    subject: 'Cancellation of the open balance of {po.number}',
    body:
      'Dear {supplier.contact},\n\nPlease cancel the undelivered balance of {po.number}:\n{cancel.lines}\n\n' +
      'Reason: {cancel.reason}. Goods already delivered are not affected.\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: true,
    autoSend: true,
  },
  {
    key: 'RETURN_NOTICE',
    name: 'Return notice',
    description: 'With the RMA number',
    toTemplate: '{supplier.email}',
    ccTemplate: '{buyer.email}',
    subject: 'Return {return.number} · RMA {return.rma}',
    body:
      'Dear {supplier.contact},\n\nAs agreed, we are returning the following goods from {return.grn_number} under RMA ' +
      '{return.rma}:\n{return.lines}\n\nReason: {return.reason}. Collection: {return.collection}.\n' +
      'Please send a credit note for {return.currency} {return.total}.\n\nRegards,\n{buyer.name}\n{company.name}',
    attachPdf: true,
    autoSend: true,
  },
  {
    key: 'APPROVAL_REQUEST',
    name: 'Approval request',
    description: 'Internal, to the approver',
    toTemplate: '{approver.email}',
    ccTemplate: null,
    subject: '{doc.number} is waiting for your approval',
    body:
      'Dear {approver.name},\n\n{requester.name} sent {doc.number} ({doc.title}) for your approval.\n\n' +
      'Why approval is needed: {approval.reason}\nAmount: {doc.currency} {doc.total}\nNote: {approval.note}\n\n' +
      'Open your Approvals inbox to decide.\n\n{company.name}',
    attachPdf: false,
    autoSend: true,
  },
];

/** Opening "last price" per item from the old system (SEED_DATA.md items table). FB-OAK-01 has real history. */
const OPENING_PRICES: Record<string, string> = {
  'FB-GRY-02': '40.00', 'FM-SEA-05': '35.00', 'SC-WOD-08': '18.00', 'VR-LAC-01': '95.00', 'PT-STN-03': '155.00',
  'HW-HNG-02': '21.60', 'DR-RUN-04': '12.00', 'CH-DIN-01': '150.00', 'TB-DIN-06': '820.00', 'SF-CUS-03': '2100.00',
  'MJ-IND-01': '25000.00', 'MJ-PF-11': '109.00', 'SV-INS-01': '500.00', 'OF-TNR-01': '90.00',
  'TM-OAK-01': '45.00', 'OF-DSK-01': '900.00', 'OF-CLN-01': '86.40', 'PT-SMP-01': '30.00', 'TL-DRL-01': '132.00',
  'EL-EXT-01': '25.00', 'SV-FRT-01': '120.00', 'SV-TNT-01': '66.00',
};

/** On-time record, last 12 months, from the old system. S-0021, S-0034, S-0009 are from the mockups; the rest invented. */
const SUPPLIER_STATS = [
  { code: 'S-0021', deliveries: 24, pct: '96.00' },
  { code: 'S-0034', deliveries: 9, pct: '88.00' },
  { code: 'S-0009', deliveries: 16, pct: '81.00' },
  { code: 'S-0047', deliveries: 12, pct: '92.00' },
  { code: 'S-0052', deliveries: 5, pct: '100.00' },
  { code: 'S-0015', deliveries: 14, pct: '93.00' },
  { code: 'S-0061', deliveries: 4, pct: '75.00' },
  { code: 'S-0063', deliveries: 3, pct: '100.00' },
];

export async function seedSettings(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;

  for (const s of SEQUENCES) {
    const data = { module: 'purchase', name: s.name, prefix: `${s.docType}-`, digits: 4, nextValue: s.next };
    await prisma.sysNumberSequence.upsert({
      where: { tenantId_docType: { tenantId, docType: s.docType } },
      update: data,
      create: { tenantId, docType: s.docType, ...data },
    });
  }

  await prisma.purPoType.createMany({
    data: PO_TYPES.map((t, i) => ({
      tenantId,
      code: t.code,
      name: t.name,
      description: t.description,
      needsGoodsReceipt: t.needsGoodsReceipt,
      linkedToSalesOrder: t.linkedToSalesOrder ?? false,
      sendsToAssetRegister: t.sendsToAssetRegister ?? false,
      sortOrder: i + 1,
    })),
  });

  const money = (v: string) => new Prisma.Decimal(v);
  await prisma.purApprovalRule.createMany({
    data: [
      { docType: 'PO', branchCode: 'HQ', condition: 'OVER_AMOUNT', thresholdAmount: money('10000'), approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ', secondOverAmount: money('50000'), secondApproverRole: 'FINANCE_DIRECTOR', secondApproverCode: 'RI' },
      { docType: 'PO', branchCode: 'PNG', condition: 'OVER_AMOUNT', thresholdAmount: money('5000'), approverRole: 'BRANCH_MANAGER', approverCode: 'TWL', secondOverAmount: money('50000'), secondApproverRole: 'FINANCE_DIRECTOR', secondApproverCode: 'RI' },
      { docType: 'PI', branchCode: null, condition: 'OUTSIDE_TOLERANCE', thresholdAmount: null, approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ' },
      { docType: 'PDN', branchCode: null, condition: 'CHARGE_NOT_ON_PO', thresholdAmount: null, approverRole: 'PURCHASE_MANAGER', approverCode: 'AZ' },
      { docType: 'CP', branchCode: null, condition: 'BLOCKED_OVER_AMOUNT', thresholdAmount: money('1000'), approverRole: null, approverCode: null },
    ].map((r, i) => ({ tenantId, sortOrder: i + 1, updatedBy: 'ADM', ...r })),
  });

  await prisma.purSetting.create({
    data: {
      tenantId,
      priceTolerancePct: money('2'),
      qtyToleranceOver: money('0'),
      taxToleranceAmount: money('1'),
      rfqRequiredOn: true,
      rfqRequiredOver: money('50000'),
      rfqMinReplies: 2,
      allowOverReceipt: false,
      autoDraftBuyToOrder: true,
      onlyActiveSuppliers: true,
      buyerCannotApproveOwnPo: true,
      numberWithBranchCode: false,
      updatedBy: 'AZ',
    },
  });

  await prisma.purSettingChange.createMany({
    data: [
      { at: kl('2026-09-22', '10:30'), by: 'AZ', message: 'Penang PO limit raised to RM 5,000.00' },
      { at: kl('2026-09-15', '14:00'), by: 'ADM', message: 'RFQ threshold raised to RM 50,000.00' },
      { at: kl('2026-09-01', '09:00'), by: 'ADM', message: 'Turned on auto-draft for buy-to-order' },
    ].map((c) => ({ tenantId, area: 'APPROVAL_RULES', message: c.message, userCode: c.by, userName: nameOf(ctx, c.by), createdAt: c.at })),
  });

  await prisma.purPaymentMethod.createMany({
    data: [
      { code: 'CARD-4471', kind: 'COMPANY_CARD' as const, label: 'Company card ···· 4471', cardLast4: '4471', holder: 'HQ Store', branchCode: 'HQ', floatAmount: null },
      { code: 'PETTY-HQ', kind: 'PETTY_CASH' as const, label: 'Petty cash · HQ', cardLast4: null, holder: 'HQ Office', branchCode: 'HQ', floatAmount: money('1000') },
    ].map((p) => ({ tenantId, ...p })),
  });

  await prisma.purEmailTemplate.createMany({
    data: EMAIL_TEMPLATES.map((t, i) => ({ tenantId, sortOrder: i + 1, updatedBy: 'ADM', isActive: true, ...t })),
  });

  // Purchase history from the old system. FB-OAK-01's three rows are on the request screen (PurRequestForm.html).
  await prisma.purPriceHistory.createMany({
    data: [
      { itemCode: 'FB-OAK-01', supplierCode: 'S-0021', docNo: 'PO-L-0844', docDate: day('2026-08-12'), qty: 80, unitPrice: '40.00', note: null },
      { itemCode: 'FB-OAK-01', supplierCode: 'S-0021', docNo: 'PO-L-0811', docDate: day('2026-07-15'), qty: 100, unitPrice: '39.00', note: null },
      { itemCode: 'FB-OAK-01', supplierCode: 'S-0034', docNo: 'PO-L-0790', docDate: day('2026-06-10'), qty: 60, unitPrice: '37.50', note: 'arrived 9 days late' },
      ...Object.entries(OPENING_PRICES).map(([itemCode, price]) => ({
        itemCode,
        supplierCode: ctx.items.get(itemCode)?.preferredSupplierCode ?? null,
        docNo: null,
        docDate: day('2026-08-31'),
        qty: null,
        unitPrice: price,
        note: 'Opening price from the old system',
      })),
    ].map((h) => ({
      tenantId,
      itemCode: h.itemCode,
      supplierCode: h.supplierCode,
      supplierName: h.supplierCode ? (ctx.suppliers.get(h.supplierCode)?.name ?? null) : null,
      docNo: h.docNo,
      docDate: h.docDate,
      qty: h.qty === null ? null : new Prisma.Decimal(h.qty),
      unitPrice: new Prisma.Decimal(h.unitPrice),
      note: h.note,
    })),
  });

  await prisma.purSupplierStat.createMany({
    data: SUPPLIER_STATS.map((s) => ({
      tenantId,
      supplierCode: s.code,
      deliveries12m: s.deliveries,
      onTimePct12m: new Prisma.Decimal(s.pct),
      asOf: day('2026-08-31'),
    })),
  });
}
