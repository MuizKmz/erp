/**
 * Sales Operation Policies (SALES_SEED_DATA.md → Sales settings): numbering, credit control, order types,
 * enquiry types and sources, excluded items and email templates.
 * Invented: the two ended exclusions and the texts of the email templates other than Invoice.
 */
import { Prisma } from '@prisma/client';
import { day, kl, nameOf, type SeedCtx } from './util';

const SEQUENCES = [
  { docType: 'EQ', name: 'Enquiry', prefix: 'EQ-', format: 'EQ-{YYMM}-{####}', resetEvery: 'MONTH', periodKey: '2609', next: 11, perBranch: false, print: 'Standard' },
  { docType: 'QT', name: 'Quotation', prefix: 'QT-', format: null, resetEvery: 'NEVER', periodKey: null, next: 13, perBranch: false, print: 'With photos' },
  { docType: 'SO', name: 'Sales order', prefix: 'SO-', format: null, resetEvery: 'NEVER', periodKey: null, next: 9, perBranch: false, print: 'Standard' },
  { docType: 'DO', name: 'Delivery order', prefix: 'DO-', format: null, resetEvery: 'NEVER', periodKey: null, next: 4, perBranch: true, print: 'With signature box' },
  { docType: 'INV', name: 'Invoice', prefix: 'INV-', format: null, resetEvery: 'NEVER', periodKey: null, next: 4, perBranch: false, print: 'Tax invoice' },
  { docType: 'CS', name: 'Cash sale', prefix: 'CS-', format: null, resetEvery: 'NEVER', periodKey: null, next: 5, perBranch: true, print: 'Receipt 80 mm' },
  { docType: 'DN', name: 'Debit note', prefix: 'DN-', format: null, resetEvery: 'NEVER', periodKey: null, next: 2, perBranch: false, print: 'Standard' },
  { docType: 'SR', name: 'Sales return', prefix: 'SR-', format: null, resetEvery: 'NEVER', periodKey: null, next: 3, perBranch: false, print: 'Credit note' },
  { docType: 'PF', name: 'Proforma invoice', prefix: 'PF-', format: null, resetEvery: 'NEVER', periodKey: null, next: 5, perBranch: false, print: 'Proforma' },
  { docType: 'CO', name: 'Cancel order', prefix: 'CO-', format: null, resetEvery: 'NEVER', periodKey: null, next: 3, perBranch: false, print: 'Standard' },
];

const CREDIT_RULES = [
  { docType: 'QUOTATION', overCredit: 'WARN', overOverdue: 'WARN', approver: null },
  { docType: 'SALES_ORDER', overCredit: 'APPROVAL', overOverdue: 'APPROVAL', approver: 'SALES_MANAGER' },
  { docType: 'DELIVERY', overCredit: 'WARN', overOverdue: 'APPROVAL', approver: 'SALES_MANAGER' },
  { docType: 'INVOICE', overCredit: 'APPROVAL', overOverdue: 'APPROVAL', approver: 'FINANCE_MANAGER' },
  { docType: 'CASH_SALE', overCredit: 'ALLOW', overOverdue: 'WARN', approver: null },
];

const ENQUIRY_TYPES = [
  { code: 'BULK', name: 'Furniture bulk', details: [{ label: 'Quantity range', kind: 'TEXT', required: true }, { label: 'Delivery city', kind: 'TEXT', required: true }] },
  {
    code: 'CUSTOM', name: 'Custom order', rule: 'ROUND_ROBIN', details: [
      { label: 'Dimensions (W × D × H)', kind: 'TEXT', required: true },
      { label: 'Material', kind: 'CHOICE', required: true, choices: ['Solid oak', 'Teak', 'Walnut', 'Rattan', 'Metal'] },
      { label: 'Finish', kind: 'CHOICE', required: false, choices: ['Natural', 'Walnut stain', 'Black', 'White'] },
      { label: 'Drawings', kind: 'FILE', required: false },
    ],
  },
  { code: 'RESELLER', name: 'Reseller', details: [{ label: 'Company registration', kind: 'TEXT', required: true }, { label: 'Showrooms', kind: 'NUMBER', required: false }] },
  { code: 'OFFICE', name: 'Office furniture', details: [{ label: 'Number of staff', kind: 'NUMBER', required: true }, { label: 'Floor plan', kind: 'FILE', required: false }] },
  { code: 'HOSPITALITY', name: 'Hospitality project', details: [{ label: 'Rooms', kind: 'NUMBER', required: true }, { label: 'Opening date', kind: 'DATE', required: false }] },
  { code: 'SPARES', name: 'Spare parts', active: false, details: [{ label: 'Original invoice number', kind: 'TEXT', required: true }] },
];

export const ENQUIRY_SOURCES = [
  { code: 'PHONE', name: 'Phone' },
  { code: 'EMAIL', name: 'Email' },
  { code: 'WEBSITE', name: 'Website' },
  { code: 'WALKIN', name: 'Walk-in' },
  { code: 'REFERRAL', name: 'Referral' },
];

const EXCLUSIONS = [
  { item: 'CH-DIN-09', name: 'Dining chair, rattan', branch: 'PNG', reason: 'Supplier recall', from: '2026-09-15', until: null, by: 'NA', ended: false },
  { item: 'CH-DIN-09', name: 'Dining chair, rattan', branch: 'HQ', reason: 'Supplier recall', from: '2026-09-15', until: null, by: 'NA', ended: false },
  { item: 'SF-CUS-03', name: 'Custom 3-seater sofa, grey linen', branch: 'PNG', reason: 'Not offered in branch', from: '2026-07-01', until: null, by: 'ADM', ended: false },
  { item: 'TB-OUT-02', name: 'Outdoor table, teak', branch: 'HQ', reason: 'Seasonal', from: '2026-11-01', until: '2027-02-28', by: 'AR', ended: false },
  { item: 'CU-SET-02', name: 'Seat cushion set', branch: 'PNG', reason: 'Pricing under review', from: '2026-09-20', until: '2026-10-20', by: 'LWJ', ended: false },
  // Ended earlier this year (invented)
  { item: 'CH-BAR-01', name: 'Bar stool, oak', branch: 'PNG', reason: 'Stock clearance', from: '2026-03-01', until: '2026-05-31', by: 'LWJ', ended: true },
  { item: 'TB-DIN-06', name: 'Dining table, 6-seater', branch: 'HQ', reason: 'Pricing under review', from: '2026-06-01', until: '2026-06-30', by: 'NA', ended: true },
];

export const SALES_EMAIL_TEMPLATES = [
  {
    key: 'QUOTATION', name: 'Quotation', description: 'Sent from quotations', copyAgent: true,
    subject: 'Quotation {document.number} from {company.name}',
    body: 'Dear {contact.name},\n\nPlease find attached our quotation {document.number} for {document.total}.\n\nIf you would like to go ahead, reply to this email or contact {agent.name} at {agent.phone}.\n\nThank you,\n{company.name}',
  },
  {
    key: 'ORDER_CONFIRMATION', name: 'Order confirmation', description: 'Sent from sales orders', copyAgent: true,
    subject: 'Order confirmation {document.number} from {company.name}',
    body: 'Dear {contact.name},\n\nThank you for your order. Please find attached our order confirmation {document.number} for {document.total}.\nYour reference: {document.customer_ref}\n\nWe will let you know when it is on its way.\n\nThank you,\n{company.name}',
  },
  {
    key: 'INVOICE', name: 'Invoice', description: 'Sent from invoices', copyAgent: true,
    subject: 'Invoice {document.number} from {company.name}',
    body: 'Dear {contact.name},\nPlease find attached invoice {document.number} for {document.total}, due on {document.due_date}.\nYour reference: {document.customer_ref}\nIf you have any questions, reply to this email or contact {agent.name} at {agent.phone}.\nThank you,\n{company.name}',
  },
  {
    key: 'PROFORMA', name: 'Proforma · deposit request', description: 'Sent from proformas', copyAgent: true,
    subject: 'Deposit request {document.number} from {company.name}',
    body: 'Dear {contact.name},\n\nPlease find attached proforma invoice {document.number} for {document.total}, to be paid by {document.due_date}.\nDelivery is scheduled once the payment is received.\n\nThank you,\n{company.name}',
  },
  {
    key: 'DELIVERY_NOTICE', name: 'Delivery notice', description: 'Sent when a DO is confirmed', copyAgent: false,
    subject: 'Your order is on its way · {document.number}',
    body: 'Dear {contact.name},\n\nYour goods left our warehouse today on delivery order {document.number}.\nYour reference: {document.customer_ref}\n\nThank you,\n{company.name}',
  },
  {
    key: 'OVERDUE_REMINDER', name: 'Overdue reminder', description: 'Sent manually from an invoice', copyAgent: true,
    subject: 'Reminder: invoice {document.number} is overdue',
    body: 'Dear {contact.name},\n\nOur records show invoice {document.number} for {document.total} was due on {document.due_date} and is still open.\nIf you have already paid, please ignore this email.\n\nThank you,\n{company.name}',
  },
];

export async function seedSalesSettings(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;

  for (const s of SEQUENCES) {
    const data = {
      module: 'sales', name: s.name, prefix: s.prefix, digits: 4, nextValue: s.next, format: s.format,
      resetEvery: s.resetEvery, periodKey: s.periodKey, perBranch: s.perBranch, printTemplate: s.print,
    };
    await prisma.sysNumberSequence.upsert({
      where: { tenantId_docType: { tenantId, docType: s.docType } },
      update: data,
      create: { tenantId, docType: s.docType, ...data },
    });
  }

  await prisma.salSetting.create({ data: { tenantId, creditScope: 'GROUP', updatedBy: 'ADM', updatedAt: kl('2026-09-15', '14:00') } });
  await prisma.salCreditRule.createMany({
    data: CREDIT_RULES.map((r, i) => ({
      tenantId, docType: r.docType, overCreditAction: r.overCredit, overOverdueAction: r.overOverdue, approverRole: r.approver, sortOrder: i + 1, updatedBy: 'ADM',
    })),
  });
  await prisma.salSettingChange.createMany({
    data: [
      { at: kl('2026-09-15', '14:00'), by: 'ADM', message: 'Invoice, over credit limit: Block → Require approval' },
      { at: kl('2026-09-02', '10:00'), by: 'NA', message: 'Sales order approver set to Sales Manager' },
      { at: kl('2026-08-20', '09:30'), by: 'ADM', message: 'Credit scope: Per branch → Group-wide' },
    ].map((c) => ({ tenantId, area: 'CREDIT_CONTROL', message: c.message, userCode: c.by, userName: nameOf(ctx, c.by), createdAt: c.at })),
  });

  await prisma.salOrderType.createMany({
    data: [
      { code: 'STD', name: 'Standard', meaning: 'Ship from stock', isDefault: true },
      { code: 'BTO', name: 'Buy to order', meaning: 'Purchase drafts a PO when released', isDefault: false },
      { code: 'PRJ', name: 'Project', meaning: 'Linked to a project for reporting', isDefault: false },
    ].map((t, i) => ({ tenantId, ...t, sortOrder: i + 1 })),
  });

  await prisma.salEnquiryType.createMany({
    data: ENQUIRY_TYPES.map((t, i) => ({
      tenantId, code: t.code, name: t.name, details: t.details as Prisma.InputJsonValue, defaultAgentRule: t.rule ?? 'CUSTOMER', isActive: t.active ?? true, sortOrder: i + 1,
    })),
  });
  await prisma.salEnquirySource.createMany({ data: ENQUIRY_SOURCES.map((s, i) => ({ tenantId, ...s, sortOrder: i + 1 })) });

  await prisma.salExcludedItem.createMany({
    data: EXCLUSIONS.map((e) => ({
      tenantId, itemCode: e.item, itemName: e.name, branchCode: e.branch, reason: e.reason, fromDate: day(e.from), untilDate: e.until ? day(e.until) : null,
      addedByCode: e.by, addedByName: nameOf(ctx, e.by), createdAt: kl(e.from, '09:00'),
      removedAt: null, removedBy: null,
    })),
  });

  await prisma.salEmailTemplate.createMany({
    data: SALES_EMAIL_TEMPLATES.map((t, i) => ({ tenantId, ...t, attachPdf: true, isActive: true, sortOrder: i + 1, updatedBy: 'ADM' })),
  });
}
