/**
 * Everything around the documents: approvals, activity, document links, the email log, outbox events
 * and attachments. Activity texts and times are copied from the mockups where they show them.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { Prisma } from '@prisma/client';
import { toMoney, toQty } from '../../src/platform/http/decimal';
import { renderTemplate, type TemplateVariables } from '../../src/purchase/shared/email-template.rules';
import { DOC_LINK, EXTERNAL_ENTITY, PUR_ENTITY } from '../../src/purchase/shared/purchase.constants';
import { EMAIL_TEMPLATES } from './settings';
import { PI_0001_MESSAGE } from './documents-receive';
import { createSeededEvents } from './event-history';
import { doc, kl, nameOf, placeholderPdf, supplier, user, type SeedCtx } from './util';

const COMPANY = 'CLB Groups';
const FRONTEND = 'http://localhost:5173';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 29 Sep 2026, from a DATE column (stored as UTC midnight). */
function fmtDate(d: Date | null | undefined): string {
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : '';
}
/** 4,400.00 */
function fmtMoney(v: Prisma.Decimal | string): string {
  const [whole, cents] = toMoney(v).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
/** 100 (whole units) or 2.50 */
function fmtQty(v: Prisma.Decimal): string {
  return v.isInteger() ? v.toFixed(0) : v.toFixed(2);
}

// ── Approvals ───────────────────────────────────────────────────────────────

interface ApprovalSeed {
  docNo: string; title: string; reason: string; note?: string; amount: string; requestedAt: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED'; decidedAt?: Date; comment?: string;
}

/** Approver for every seeded request: Ahmad Zaki, Purchasing Manager (SEED_DATA.md → Approvals). */
const APPROVALS: ApprovalSeed[] = [
  {
    docNo: 'PO-0003', title: 'PO-0003 · Perabot Kayu Timur', amount: '46200.00', status: 'PENDING', requestedAt: kl('2026-09-29', '09:50'),
    reason: 'RM 46,200.00 is over the RM 10,000.00 limit for HQ Shah Alam · buy to order for SO-0003',
    note: 'Buy-to-order for Hotel Seri Bayu (SO-0003). Contract price, no RFQ needed. Supplier needs the PO by 30 Sep to deliver on 9 Oct.',
  },
  {
    docNo: 'PI-0002', title: 'PI-0002 · Mesin Jahit Pro Sdn Bhd', amount: '25800.00', status: 'PENDING', requestedAt: kl('2026-09-28', '16:40'),
    reason: 'Billed RM 25,800.00 against PO price RM 25,000.00 · +3.2%, over the 2% tolerance',
    note: 'Freight was not in their quotation. Supplier says it was agreed by phone. Please decide.',
  },
  {
    docNo: 'PO-0002', title: 'PO-0002 · Mesin Jahit Pro Sdn Bhd', amount: '25000.00', status: 'APPROVED', requestedAt: kl('2026-09-24', '09:30'),
    reason: 'RM 25,000.00 over RM 10,000.00 limit', note: 'Second industrial machine for the sofa line, as budgeted.',
    decidedAt: kl('2026-09-24', '11:00'), comment: 'Approved. The machine is in this year’s budget.',
  },
  {
    docNo: 'PI-L-0321', title: 'PI-L-0321 · Hardware Mart Klang', amount: '648.00', status: 'REJECTED', requestedAt: kl('2026-09-22', '15:00'),
    reason: 'Quantity billed above quantity received', decidedAt: kl('2026-09-23', '09:30'),
    comment: 'Billed 30 packs but only 20 arrived. Ask for a corrected invoice.',
  },
  {
    docNo: 'PO-L-0879', title: 'PO-L-0879 · Cat Warna Sdn Bhd', amount: '12400.00', status: 'APPROVED', requestedAt: kl('2026-09-21', '16:00'),
    reason: 'RM 12,400.00 over RM 10,000.00 limit', decidedAt: kl('2026-09-22', '10:00'), comment: 'Approved for the walnut range.',
  },
];

async function seedApprovals(ctx: SeedCtx): Promise<void> {
  const approver = user(ctx, 'AZ');
  const requester = user(ctx, 'LMY');
  for (const a of APPROVALS) {
    const target = doc(ctx, a.docNo);
    await ctx.prisma.sysApprovalRequest.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: target.type,
        entityId: target.id,
        docNo: a.docNo,
        branchCode: 'HQ',
        amount: a.amount,
        title: a.title,
        reason: a.reason,
        requesterNote: a.note ?? null,
        requestedByCode: requester.code,
        requestedByName: requester.name,
        status: a.status,
        currentStep: 1,
        createdAt: a.requestedAt,
        decidedAt: a.decidedAt ?? null,
        steps: {
          create: [{
            tenantId: ctx.tenantId,
            stepNo: 1,
            approverRole: 'PURCHASE_MANAGER',
            approverCode: approver.code,
            approverName: approver.name,
            status: a.status === 'PENDING' ? 'WAITING' : a.status,
            decidedByCode: a.decidedAt ? approver.code : null,
            decidedByName: a.decidedAt ? approver.name : null,
            comment: a.comment ?? null,
            decidedAt: a.decidedAt ?? null,
          }],
        },
      },
    });
  }
}

// ── Activity ────────────────────────────────────────────────────────────────

type ActivityRow = [docNo: string, at: Date, by: string, action: string, message: string, comment?: string];

const RFQ_0001_REASON =
  'Tekstil Utara is RM 200.00 cheaper but cannot deliver before 14 Oct. We need the fabric by 30 Sep for SO-0001 chairs.';

const ACTIVITY: ActivityRow[] = [
  // Main case — texts from PurRequestForm, RfqCompare, PoForm, GrnConfirm, PiMatch, PurReturn
  ['PRQ-0001', kl('2026-09-22', '09:10'), 'RAH', 'created', 'Created from the demand list by Rahim'],
  ['PRQ-0001', kl('2026-09-22', '09:12'), 'RAH', 'submitted', 'Submitted to Purchasing · Lim Mei Ying notified'],
  ['PRQ-0001', kl('2026-09-22', '09:40'), 'LMY', 'opened', 'Opened by Lim Mei Ying'],
  ['PRQ-0001', kl('2026-09-22', '15:10'), 'LMY', 'converted', 'Converted to RFQ-0001'],
  ['RFQ-0001', kl('2026-09-22', '15:10'), 'LMY', 'sent', 'RFQ sent to 2 suppliers by Lim Mei Ying'],
  ['RFQ-0001', kl('2026-09-22', '17:42'), 'S-0034', 'replied', 'Tekstil Utara replied · RM 38.00, 3 weeks'],
  ['RFQ-0001', kl('2026-09-23', '09:15'), 'S-0021', 'replied', 'Kilang Kain Jaya replied · RM 40.00, 1 week'],
  ['RFQ-0001', kl('2026-09-23', '10:48'), 'LMY', 'awarded', 'Awarded to Kilang Kain Jaya · PO-0001 drafted', RFQ_0001_REASON],
  ['PO-0001', kl('2026-09-23', '10:48'), 'LMY', 'created', 'Created from RFQ-0001 award by Lim Mei Ying'],
  ['PO-0001', kl('2026-09-23', '11:02'), 'LMY', 'released', 'Released · emailed to sales@kilangkainjaya.my'],
  ['PO-0001', kl('2026-09-25', '15:15'), 'RAH', 'received', 'GRN-0001: 95 of 100 rolls received by Rahim'],
  ['PO-0001', kl('2026-09-26', '09:30'), 'LMY', 'billed', 'PI-0001 matched: billed quantity corrected from 100 to 95'],
  ['PO-0001', kl('2026-09-28', '11:20'), 'LMY', 'returned', 'PRT-0001: 10 rolls returned, wrong colour · credit note expected'],
  ['PO-0001', kl('2026-09-29', '08:45'), 'LMY', 'note', 'Supplier confirmed the last 5 rolls for 2 Oct'],
  ['GRN-0001', kl('2026-09-25', '14:40'), 'RAH', 'created', 'Lorry BKL 4471 arrived · Rahim started counting'],
  ['GRN-0001', kl('2026-09-25', '14:52'), 'RAH', 'counted', '95 rolls counted · 5 short against KKJ-DO-7781'],
  ['GRN-0001', kl('2026-09-25', '14:55'), 'RAH', 'attached', 'Photos of the delivery order and pallets added'],
  ['GRN-0001', kl('2026-09-25', '15:30'), 'RAH', 'confirmed', 'Confirmed · 95 received, 5 short kept open'],
  ['PI-0001', kl('2026-09-26', '09:30'), 'LMY', 'created', 'Recorded KKJ-INV-10442 · 5 rolls billed, not received'],
  ['PI-0001', kl('2026-09-26', '16:15'), 'LMY', 'approved', 'Recorded only what was received: 95 rolls, RM 4,180.00 · supplier emailed'],
  ['PRT-0001', kl('2026-09-26', '16:10'), 'RAH', 'note', 'Upholstery found 10 rolls in the wrong colour'],
  ['PRT-0001', kl('2026-09-28', '10:45'), 'LMY', 'note', 'Supplier agreed to take them back · RMA KKJ-RMA-0219'],
  ['PRT-0001', kl('2026-09-28', '11:20'), 'LMY', 'created', 'Return drafted by Lim Mei Ying'],
  ['PRT-0001', kl('2026-09-28', '14:00'), 'LMY', 'released', 'Released · return notice emailed with RMA KKJ-RMA-0219'],

  // Other documents
  ['PO-0003', kl('2026-09-27', '16:20'), 'SYSTEM', 'created', 'Drafted by the system when SO-0003 was released'],
  ['PO-0003', kl('2026-09-29', '09:45'), 'LMY', 'opened', 'Opened by Lim Mei Ying'],
  ['PO-0003', kl('2026-09-29', '09:50'), 'LMY', 'submitted', 'Sent for approval to Ahmad Zaki', APPROVALS[0]!.note],
  ['PO-0002', kl('2026-09-24', '09:20'), 'LMY', 'created', 'Created from PRQ-0002'],
  ['PO-0002', kl('2026-09-24', '09:30'), 'LMY', 'submitted', 'Sent for approval to Ahmad Zaki'],
  ['PO-0002', kl('2026-09-24', '11:00'), 'AZ', 'approved', 'Approved by Ahmad Zaki', APPROVALS[2]!.comment],
  ['PO-0002', kl('2026-09-24', '11:30'), 'LMY', 'released', 'Released · emailed to accounts@mesinjahitpro.my'],
  ['PO-0002', kl('2026-09-26', '10:00'), 'HAF', 'received', 'GRN-0002: 1 of 1 received by Hafiz'],
  ['GRN-0002', kl('2026-09-26', '09:30'), 'HAF', 'created', 'Delivery arrived · Hafiz started counting'],
  ['GRN-0002', kl('2026-09-26', '10:00'), 'HAF', 'confirmed', 'Confirmed · 1 of 1 received'],
  ['PI-0002', kl('2026-09-28', '16:20'), 'LMY', 'created', 'Recorded MJP-INV-2291 · price RM 800.00 (3.2%) over the PO'],
  ['PI-0002', kl('2026-09-28', '16:40'), 'LMY', 'submitted', 'Sent for approval to Ahmad Zaki', APPROVALS[1]!.note],
  ['PI-0003', kl('2026-09-29', '09:10'), 'LMY', 'created', 'Recorded TUE-INV-3310 · waiting to be matched'],
  ['PO-0004', kl('2026-09-28', '14:20'), 'LMY', 'created', 'Created from PRQ-0004'],
  ['PO-0004', kl('2026-09-28', '14:30'), 'LMY', 'released', 'Released · emailed to sales@kilangkainjaya.my'],
  ['PO-0005', kl('2026-09-28', '11:00'), 'LMY', 'created', 'Created from RFQ-0002 award by Lim Mei Ying'],
  ['PO-0006', kl('2026-09-29', '09:30'), 'LMY', 'created', 'Created by Lim Mei Ying'],
  ['GRN-0003', kl('2026-09-29', '09:40'), 'RAH', 'created', 'Delivery CW-DO-2241 arrived · Rahim started counting'],
  ['PO-L-0861', kl('2026-09-17', '16:00'), 'RAH', 'received', 'GRN-L-0406: 20 of 30 packs received (old system)'],
  ['PO-L-0861', kl('2026-09-29', '09:55'), 'LMY', 'cancel_drafted', 'PCO-0001 drafted for the 10 open packs'],
  ['PCO-0001', kl('2026-09-26', '11:10'), 'LMY', 'note', 'Supplier letter received: item discontinued by maker'],
  ['PCO-0001', kl('2026-09-29', '09:55'), 'LMY', 'created', 'PCO-0001 drafted by Lim Mei Ying'],
  ['CP-0002', kl('2026-09-29', '09:20'), 'RAH', 'created', 'Created on phone by Rahim at the shop'],
  ['CP-0002', kl('2026-09-29', '09:21'), 'RAH', 'attached', 'Receipt photo HMK-R-55120.jpg added'],
  ['CP-0002', kl('2026-09-29', '09:48'), 'LMY', 'opened', 'Opened by Lim Mei Ying for checking'],
  ['CP-0001', kl('2026-09-21', '11:00'), 'SIT', 'created', 'Created by Siti with the receipt photo'],
  ['CP-0001', kl('2026-09-21', '11:00'), 'LMY', 'released', 'Released · recorded as paid from petty cash'],
  ['PDN-0001', kl('2026-09-29', '08:30'), 'LMY', 'note', 'MJP-DN-0412 received by email from accounts@mesinjahitpro.my'],
  ['PDN-0001', kl('2026-09-29', '09:05'), 'LMY', 'created', 'Recorded by Lim Mei Ying · supplier says training was agreed at delivery'],
  ['PRQ-0002', kl('2026-09-24', '08:30'), 'HAF', 'created', 'Created by Hafiz'],
  ['PRQ-0002', kl('2026-09-24', '08:40'), 'HAF', 'submitted', 'Submitted to Purchasing · Lim Mei Ying notified'],
  ['PRQ-0002', kl('2026-09-24', '09:20'), 'LMY', 'converted', 'Converted to PO-0002'],
  ['PRQ-0003', kl('2026-09-28', '08:30'), 'NUR', 'created', 'Created by Nurul'],
  ['PRQ-0003', kl('2026-09-28', '08:35'), 'NUR', 'submitted', 'Submitted to Purchasing · Lim Mei Ying notified'],
  ['PRQ-0003', kl('2026-09-28', '11:00'), 'LMY', 'converted', 'Converted through RFQ-0002 to PO-0005'],
  ['PRQ-0004', kl('2026-09-28', '09:00'), 'RAH', 'created', 'Created from the demand list by Rahim'],
  ['PRQ-0004', kl('2026-09-28', '09:05'), 'RAH', 'submitted', 'Submitted to Purchasing · Lim Mei Ying notified'],
  ['PRQ-0004', kl('2026-09-28', '14:20'), 'LMY', 'converted', 'Converted to PO-0004'],
  ['PRQ-0005', kl('2026-09-29', '08:40'), 'SIT', 'created', 'Created by Siti'],
  ['PRQ-0005', kl('2026-09-29', '08:50'), 'SIT', 'submitted', 'Submitted to Purchasing · Lim Mei Ying notified'],
  ['PRQ-0006', kl('2026-09-29', '08:30'), 'RAH', 'created', 'Created from the demand list by Rahim'],
  ['RFQ-0002', kl('2026-09-24', '10:00'), 'LMY', 'sent', 'RFQ sent to 3 suppliers by Lim Mei Ying'],
  ['RFQ-0002', kl('2026-09-25', '11:00'), 'S-0034', 'replied', 'Tekstil Utara replied · RM 35.00, 2 weeks'],
  ['RFQ-0002', kl('2026-09-25', '15:00'), 'S-0021', 'replied', 'Kilang Kain Jaya replied · RM 37.00, 10 days'],
  ['RFQ-0002', kl('2026-09-26', '09:30'), 'S-0061', 'replied', 'Perabot Selatan replied · RM 38.50, 3 weeks'],
  ['RFQ-0002', kl('2026-09-28', '11:00'), 'LMY', 'awarded', 'Awarded to Tekstil Utara · PO-0005 drafted'],
  ['RFQ-0003', kl('2026-09-28', '14:10'), 'LMY', 'sent', 'RFQ sent to 2 suppliers by Lim Mei Ying'],
  ['RFQ-0003', kl('2026-09-28', '17:05'), 'S-0047', 'replied', 'Perabot Kayu Timur replied · RM 1,450.00 each, 4 weeks'],
  ['RFQ-0004', kl('2026-09-29', '09:30'), 'LMY', 'sent', 'RFQ sent to 3 suppliers by Lim Mei Ying'],
];

function actorName(ctx: SeedCtx, code: string): string {
  if (code.startsWith('S-')) return supplier(ctx, code).shortName ?? supplier(ctx, code).name;
  return nameOf(ctx, code);
}

async function seedActivity(ctx: SeedCtx): Promise<void> {
  const rows: Prisma.SysActivityCreateManyInput[] = ACTIVITY.map(([docNo, at, by, action, message, comment]) => {
    const target = doc(ctx, docNo);
    return {
      tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, docNo, action, message,
      comment: comment ?? null, userCode: by, userName: actorName(ctx, by), createdAt: at,
    };
  });

  // Every migrated document gets one line saying where it came from.
  for (const [docNo, target] of ctx.docs) {
    if (!docNo.includes('-L-') || docNo.includes('/')) continue;
    rows.push({
      tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, docNo, action: 'migrated',
      message: 'Brought over from the old system', userCode: 'SYSTEM', userName: 'System', createdAt: kl('2026-09-30', '23:00'),
    });
  }
  await ctx.prisma.sysActivity.createMany({ data: rows });
}

// ── Document links ──────────────────────────────────────────────────────────

const LINKS: [from: string, to: string, linkType: string][] = [
  ['PRQ-0001', 'RFQ-0001', DOC_LINK.CONVERTED],
  ['RFQ-0001', 'PO-0001', DOC_LINK.AWARDED],
  ['PO-0001', 'GRN-0001', DOC_LINK.RECEIVED],
  ['GRN-0001', 'PI-0001', DOC_LINK.BILLED],
  ['GRN-0001', 'PRT-0001', DOC_LINK.RETURNED],
  ['PRQ-0002', 'PO-0002', DOC_LINK.CONVERTED],
  ['PO-0002', 'GRN-0002', DOC_LINK.RECEIVED],
  ['GRN-0002', 'PI-0002', DOC_LINK.BILLED],
  ['PI-0002', 'PDN-0001', DOC_LINK.DEBITED],
  ['PRQ-0003', 'RFQ-0002', DOC_LINK.CONVERTED],
  ['RFQ-0002', 'PO-0005', DOC_LINK.AWARDED],
  ['PRQ-0004', 'PO-0004', DOC_LINK.CONVERTED],
  ['SO-0003', 'PO-0003', DOC_LINK.DRAFTED_FROM],
  ['SO-0008', 'RFQ-0003', DOC_LINK.DRAFTED_FROM],
  ['PO-L-0879', 'GRN-0003', DOC_LINK.RECEIVED],
  ['PRQ-L-0141', 'PO-L-0877', DOC_LINK.CONVERTED],
  ['PO-L-0877', 'GRN-L-0410', DOC_LINK.RECEIVED],
  ['GRN-L-0410', 'PI-L-0318', DOC_LINK.BILLED],
  ['PRQ-L-0139', 'RFQ-L-0058', DOC_LINK.CONVERTED],
  ['PO-L-0870', 'GRN-L-0398', DOC_LINK.RECEIVED],
  ['GRN-L-0398', 'PI-0003', DOC_LINK.BILLED],
  ['PO-L-0861', 'GRN-L-0406', DOC_LINK.RECEIVED],
  ['GRN-L-0406', 'PI-L-0321', DOC_LINK.BILLED],
  ['PO-L-0861', 'PCO-0001', DOC_LINK.CANCELLED],
];

async function seedLinks(ctx: SeedCtx): Promise<void> {
  const end = (no: string) => {
    if (no.startsWith('SO-')) return { type: EXTERNAL_ENTITY.SALES_ORDER, id: null };
    const d = doc(ctx, no);
    return { type: d.type, id: d.id };
  };
  await ctx.prisma.sysDocLink.createMany({
    data: LINKS.map(([fromNo, toNo, linkType]) => {
      const from = end(fromNo);
      const to = end(toNo);
      return { tenantId: ctx.tenantId, fromType: from.type, fromId: from.id, fromNo, toType: to.type, toId: to.id, toNo, linkType };
    }),
  });
}

// ── Email log (emails are logged, not sent) ─────────────────────────────────

function template(key: string) {
  const t = EMAIL_TEMPLATES.find((x) => x.key === key);
  if (!t) throw new Error(`Seed: no email template ${key}`);
  return t;
}

async function seedEmails(ctx: SeedCtx): Promise<void> {
  const rows: Prisma.SysEmailLogCreateManyInput[] = [];
  const buyer = user(ctx, 'LMY');
  const base: TemplateVariables = { 'company.name': COMPANY, 'buyer.name': buyer.name, 'buyer.email': buyer.email };

  const log = (key: string, vars: TemplateVariables, at: Date, docNo: string, by = 'LMY') => {
    const t = template(key);
    const all = { ...base, ...vars };
    const target = doc(ctx, docNo);
    rows.push({
      tenantId: ctx.tenantId,
      entityType: target.type,
      entityId: target.id,
      docNo,
      templateKey: key,
      toAddress: renderTemplate(t.toTemplate, all),
      ccAddress: t.ccTemplate ? renderTemplate(t.ccTemplate, all) : null,
      subject: renderTemplate(t.subject, all),
      body: renderTemplate(t.body, all),
      sentByCode: by,
      createdAt: at,
    });
  };

  // Purchase orders released (PurEmailTemplates.html → "Last sent")
  for (const no of ['PO-0001', 'PO-0002', 'PO-0004']) {
    const po = await ctx.prisma.purPurchaseOrder.findUniqueOrThrow({ where: { id: doc(ctx, no).id } });
    const s = supplier(ctx, po.supplierCode);
    log('PO_TO_SUPPLIER', {
      'supplier.contact': s.contactName ?? s.shortName, 'supplier.email': s.email,
      'po.number': po.docNo, 'po.date': fmtDate(po.docDate), 'po.deliver_to': po.warehouseName,
      'po.expected_date': fmtDate(po.expectedDate), 'po.currency': po.currency, 'po.total': fmtMoney(po.total),
    }, po.emailedAt!, no);
  }

  // RFQ requests and "not this time"
  const rfqs = await ctx.prisma.purRfq.findMany({
    where: { tenantId: ctx.tenantId, isMigrated: false },
    include: { lines: true, suppliers: true },
  });
  for (const rfq of rfqs) {
    const items = rfq.lines.map((l) => `- ${fmtQty(l.qty)} ${l.uomCode} · ${l.itemName} (${l.itemCode})`).join('\n');
    for (const rs of rfq.suppliers) {
      const s = supplier(ctx, rs.supplierCode);
      const vars = {
        'supplier.contact': s.contactName ?? s.shortName, 'supplier.email': s.email, 'rfq.number': rfq.docNo,
        'rfq.reply_by': fmtDate(rfq.replyBy), 'rfq.items': items, 'rfq.reply_link': `${FRONTEND}/rfq-reply/${rs.replyToken}`,
      };
      log('RFQ_REQUEST', vars, rs.askedAt, rfq.docNo);
      if (rfq.status === 'AWARDED' && !rs.isAwarded && rfq.awardedAt) log('RFQ_NOT_AWARDED', vars, rfq.awardedAt, rfq.docNo);
    }
  }

  // PI-0001: recorded only what was received
  const kkj = supplier(ctx, 'S-0021');
  log('INVOICE_DIFFERENCE', {
    'supplier.contact': kkj.contactName ?? kkj.shortName, 'supplier.email': kkj.email,
    'invoice.supplier_no': 'KKJ-INV-10442', 'invoice.recorded_total': 'RM 4,180.00', 'invoice.message': PI_0001_MESSAGE,
  }, kl('2026-09-26', '16:15'), 'PI-0001');

  // PRT-0001 return notice
  const prt = await ctx.prisma.purReturn.findUniqueOrThrow({ where: { id: doc(ctx, 'PRT-0001').id }, include: { lines: true } });
  log('RETURN_NOTICE', {
    'supplier.contact': kkj.contactName ?? kkj.shortName, 'supplier.email': kkj.email, 'return.number': prt.docNo,
    'return.rma': prt.rmaNo, 'return.grn_number': prt.grnNo, 'return.reason': prt.reason, 'return.collection': prt.collection,
    'return.lines': prt.lines.map((l) => `- ${fmtQty(l.qty)} ${l.uomCode} · ${l.itemName} (${l.itemCode})`).join('\n'),
    'return.currency': 'RM', 'return.total': fmtMoney(prt.total),
  }, prt.releasedAt!, 'PRT-0001');

  // Approval requests to Ahmad Zaki (new documents only)
  const az = user(ctx, 'AZ');
  for (const a of APPROVALS.filter((x) => !x.docNo.includes('-L-'))) {
    log('APPROVAL_REQUEST', {
      'approver.name': az.name, 'approver.email': az.email, 'requester.name': buyer.name, 'doc.number': a.docNo,
      'doc.title': a.title, 'approval.reason': a.reason, 'doc.currency': 'RM', 'doc.total': fmtMoney(a.amount),
      'approval.note': a.note ?? '—',
    }, a.requestedAt, a.docNo);
  }

  await ctx.prisma.sysEmailLog.createMany({ data: rows });
}

// ── Outbox: events waiting for Inventory, Finance and WMS ───────────────────

async function seedOutbox(ctx: SeedCtx): Promise<void> {
  const events: Prisma.SysOutboxCreateManyInput[] = [];
  const push = (name: string, aggregateType: string, aggregateId: string, actor: string, at: Date, payload: Prisma.InputJsonValue) =>
    events.push({
      id: randomUUID(), tenantId: ctx.tenantId, name, version: 1, aggregateType, aggregateId, payload, actorCode: actor,
      correlationId: randomUUID(), occurredAt: at, status: 'PENDING', attempts: 0, nextAttemptAt: at,
    });

  const requests = await ctx.prisma.purRequest.findMany({
    where: { tenantId: ctx.tenantId, isMigrated: false, submittedAt: { not: null } },
    include: { lines: true },
  });
  for (const r of requests) {
    push('purchase.request.submitted', PUR_ENTITY.REQUEST, r.id, r.requestedByCode, r.submittedAt!, {
      prqNo: r.docNo, branchCode: r.branchCode, neededBy: r.neededBy?.toISOString().slice(0, 10) ?? null,
      lines: r.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty) })),
    });
  }

  const orders = await ctx.prisma.purPurchaseOrder.findMany({
    where: { tenantId: ctx.tenantId, isMigrated: false, releasedAt: { not: null } },
    include: { lines: true },
  });
  for (const po of orders) {
    push('purchase.order.released', PUR_ENTITY.ORDER, po.id, po.releasedByCode!, po.releasedAt!, {
      poNo: po.docNo, branchCode: po.branchCode, supplierCode: po.supplierCode, expectedDate: po.expectedDate?.toISOString().slice(0, 10) ?? null,
      warehouseCode: po.warehouseCode, total: toMoney(po.total),
      lines: po.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.orderedQty), unitPrice: l.unitPrice.toFixed(4), amount: toMoney(l.amount) })),
    });
  }

  const receipts = await ctx.prisma.purGoodsReceipt.findMany({
    where: { tenantId: ctx.tenantId, isMigrated: false, status: 'CONFIRMED' },
    include: { lines: true },
  });
  for (const g of receipts) {
    push('purchase.goods.received', PUR_ENTITY.RECEIPT, g.id, g.confirmedByCode!, g.confirmedAt!, {
      grnNo: g.docNo, poNo: g.poNo, supplierCode: g.supplierCode, supplierDo: g.supplierDoNo, branchCode: g.branchCode,
      lines: g.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.receivedQty), warehouseCode: g.warehouseCode, locationCode: l.locationCode })),
    });
  }

  const pi = await ctx.prisma.purInvoice.findUniqueOrThrow({ where: { id: doc(ctx, 'PI-0001').id } });
  push('purchase.invoice.approved', PUR_ENTITY.INVOICE, pi.id, pi.approvedByCode!, pi.approvedAt!, {
    piNo: pi.docNo, supplierCode: pi.supplierCode, supplierInvoiceNo: pi.supplierInvoiceNo, poNo: pi.poNo,
    subtotal: toMoney(pi.subtotal), taxTotal: toMoney(pi.taxTotal), total: toMoney(pi.total), dueDate: pi.dueDate?.toISOString().slice(0, 10) ?? null,
  });

  const prt = await ctx.prisma.purReturn.findUniqueOrThrow({ where: { id: doc(ctx, 'PRT-0001').id }, include: { lines: true } });
  push('purchase.return.released', PUR_ENTITY.RETURN, prt.id, prt.releasedByCode!, prt.releasedAt!, {
    prtNo: prt.docNo, grnNo: prt.grnNo, supplierCode: prt.supplierCode, rmaNo: prt.rmaNo, creditExpected: toMoney(prt.total),
    lines: prt.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), warehouseCode: 'HQ-MAIN' })),
  });

  const cp = await ctx.prisma.purCashPurchase.findUniqueOrThrow({ where: { id: doc(ctx, 'CP-0001').id }, include: { lines: true } });
  push('purchase.cash_purchase.released', PUR_ENTITY.CASH_PURCHASE, cp.id, cp.releasedByCode!, cp.releasedAt!, {
    cpNo: cp.docNo, supplierCode: cp.supplierCode, paidBy: cp.paidBy, paymentMethodCode: cp.paymentMethodCode, total: toMoney(cp.total),
    lines: cp.lines.map((l) => ({ itemCode: l.itemCode, uomCode: l.uomCode, qty: toQty(l.qty), warehouseCode: cp.warehouseCode })),
  });

  await createSeededEvents(ctx, events.sort((a, b) => +new Date(a.occurredAt!) - +new Date(b.occurredAt!)));
}

// ── Attachments (placeholder files in backend/uploads) ──────────────────────

const ATTACHMENTS: [docNo: string, fileName: string, kind: string, at: Date, by: string][] = [
  ['GRN-0001', 'KKJ-DO-7781.jpg', 'DO_PHOTO', kl('2026-09-25', '14:55'), 'RAH'],
  ['GRN-0001', 'pallet-1.jpg', 'DELIVERY_PHOTO', kl('2026-09-25', '14:55'), 'RAH'],
  ['GRN-0001', 'pallet-2.jpg', 'DELIVERY_PHOTO', kl('2026-09-25', '14:55'), 'RAH'],
  ['PI-0001', 'KKJ-INV-10442.pdf', 'SUPPLIER_INVOICE', kl('2026-09-26', '09:30'), 'LMY'],
  ['PI-0002', 'MJP-INV-2291.pdf', 'SUPPLIER_INVOICE', kl('2026-09-28', '16:20'), 'LMY'],
  ['PI-0003', 'TUE-INV-3310.pdf', 'SUPPLIER_INVOICE', kl('2026-09-29', '09:10'), 'LMY'],
  ['PRT-0001', 'roll-colour-1.jpg', 'PHOTO', kl('2026-09-28', '11:20'), 'LMY'],
  ['PRT-0001', 'roll-colour-2.jpg', 'PHOTO', kl('2026-09-28', '11:20'), 'LMY'],
  ['PRT-0001', 'KKJ-RMA-0219.pdf', 'RMA', kl('2026-09-28', '11:20'), 'LMY'],
  ['PCO-0001', 'HMK-NOTICE-0926.pdf', 'SUPPLIER_LETTER', kl('2026-09-29', '09:55'), 'LMY'],
  ['CP-0002', 'HMK-R-55120.jpg', 'RECEIPT_PHOTO', kl('2026-09-29', '09:21'), 'RAH'],
  ['CP-0001', 'KRM-R-2109.jpg', 'RECEIPT_PHOTO', kl('2026-09-21', '11:00'), 'SIT'],
  ['PDN-0001', 'MJP-DN-0412.pdf', 'SUPPLIER_DOCUMENT', kl('2026-09-29', '09:05'), 'LMY'],
  ['RFQ-0001/S-0021', 'KKJ-Q-5512.pdf', 'QUOTE', kl('2026-09-23', '09:15'), 'LMY'],
  ['RFQ-0001/S-0034', 'TUE-2609-114.pdf', 'QUOTE', kl('2026-09-22', '17:42'), 'LMY'],
];

export async function seedAttachments(ctx: SeedCtx, uploadRoot: string): Promise<void> {
  const photo = await readFile(path.resolve(__dirname, '..', 'seed-assets', 'sample-photo.jpg'));
  for (const [docNo, fileName, kind, at, by] of ATTACHMENTS) {
    const target = doc(ctx, docNo);
    const id = randomUUID();
    const isPdf = fileName.endsWith('.pdf');
    const content = isPdf ? placeholderPdf(`${fileName.replace(/\.pdf$/, '')} (${docNo.split('/')[0]})`) : photo;
    const storageKey = `${ctx.tenantId}/2026/09/${id}${isPdf ? '.pdf' : '.jpg'}`;
    const absolute = path.join(uploadRoot, ...storageKey.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    const size = content.length;
    await ctx.prisma.sysAttachment.create({
      data: {
        id, tenantId: ctx.tenantId, entityType: target.type, entityId: target.id, kind, fileName,
        mimeType: isPdf ? 'application/pdf' : 'image/jpeg', sizeBytes: size, storageKey, uploadedByCode: by, createdAt: at,
      },
    });
  }
}

export async function seedRecords(ctx: SeedCtx): Promise<void> {
  await seedApprovals(ctx);
  await seedActivity(ctx);
  await seedLinks(ctx);
  await seedEmails(ctx);
  await seedOutbox(ctx);
}
