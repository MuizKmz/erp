import { reseed, startApi, type Api } from './e2e-helpers';

/**
 * The Sales handbook journeys (A–J) and the Purchase demand switch, run against the API on fresh demo data, in the
 * handbook's order (document numbers such as SO-0009 and PO-0007 depend on it). Every expected number is the one the
 * handbook tells a tester to look for.
 */
describe('Phase 2 journeys (end to end)', () => {
  let api: Api;

  beforeAll(async () => {
    reseed();
    api = await startApi();
  }, 300_000);

  afterAll(async () => {
    await api?.close();
    reseed();
  }, 300_000);

  type Line = { itemCode: string; status: string; reason: string; suggestedQty: string; salesNeed: string; salesOrders: { soNo: string; qty: string }[] };
  const demand = () => api.get<{ lines: Line[]; kpis: { toBuy: number; estimatedValue: string }; connections: { sales: boolean } }>('purchase/demand', 'LMY');
  const approvalId = async (user: string, docNo: string) => {
    const inbox = await api.get<{ items: { id: string; docNo: string }[] }>('sales/approvals', user);
    const item = inbox.items.find((i) => i.docNo === docNo);
    if (!item) throw new Error(`${docNo} is not waiting for ${user}`);
    return item.id;
  };
  const salesDoc = async (resource: string, docNo: string, user = 'ADM') => api.get(`sales/${resource}/${await api.idOf(`sales/${resource}`, docNo)}`, user);

  describe('P04 · Purchase demand from real sales orders', () => {
    it('shows the seeded demand from released orders only', async () => {
      const d = await demand();
      expect(d.connections.sales).toBe(true);
      expect(d.kpis).toMatchObject({ toBuy: 4, estimatedValue: '15440.00' });
      const tb = d.lines.find((l) => l.itemCode === 'TB-DIN-06')!;
      expect(tb).toMatchObject({ status: 'NEEDS_BUYING', reason: 'BELOW_REORDER', suggestedQty: '1.0000', salesOrders: [] });
      expect(d.lines.find((l) => l.itemCode === 'CH-DIN-01')!.salesOrders.map((s) => `${s.soNo} ${s.qty}`)).toEqual(['SO-0001 40.0000']);
    });
  });

  describe('A · Approvals inbox', () => {
    it('lists what waits for Nor Azlina', async () => {
      const inbox = await api.get<{ items: { docNo: string }[]; counts: Record<string, number> }>('sales/approvals', 'NA');
      expect(inbox.items.map((i) => i.docNo).sort()).toEqual(['INV-0003', 'SO-0002', 'SO-0008']);
      expect(inbox.counts).toMatchObject({ waiting: 3, approved: 12, rejected: 2 });
    });

    it('never lets the requester decide, then approves and releases SO-0002', async () => {
      const id = await approvalId('NA', 'SO-0002');
      const own = await api.call('POST', `sales/approvals/${id}/approve`, 'FO', { comment: 'self' });
      expect(own).toMatchObject({ status: 409, body: { message: 'You cannot approve or reject your own document.' } });
      expect((await api.call('POST', `sales/approvals/${id}/approve`, 'NA', { comment: 'Cheque promised 2 Oct' })).status).toBe(201);
      const so = await salesDoc('orders', 'SO-0002', 'FO');
      expect(so).toMatchObject({ status: 'DRAFT' });
      expect(so.allowedActions).toContain('release');
      const r = await api.call('POST', `sales/orders/${so.id}/release`, 'FO', { version: so.version });
      expect(r).toMatchObject({ status: 201, body: { status: 'RELEASED' } });
    });

    it('tells Purchase about the order: the event carries date and total, and P04 picks up the 16 chairs', async () => {
      const so = await salesDoc('orders', 'SO-0002');
      const event = await api.prisma.sysOutbox.findFirstOrThrow({ where: { name: 'sales.order.released', aggregateId: so.id } });
      expect(event.payload).toMatchObject({ soNo: 'SO-0002', docDate: '2026-09-26', total: '4400.00' });
      const chairs = await api.until('SO-0002 in P04', async () => {
        const line = (await demand()).lines.find((l) => l.itemCode === 'CH-DIN-01')!;
        return line.salesOrders.some((s) => s.soNo === 'SO-0002') ? line : null;
      });
      expect(chairs.salesNeed).toBe('56.0000');
      expect((await api.prisma.sysOutbox.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('PENDING');
    });

    it('rejects SO-0008 back to draft', async () => {
      const id = await approvalId('NA', 'SO-0008');
      expect((await api.call('POST', `sales/approvals/${id}/reject`, 'NA', { comment: 'Collect the overdue RM 12,000 first' })).status).toBe(201);
      const so = await salesDoc('orders', 'SO-0008', 'LWJ');
      expect(so.status).toBe('DRAFT');
      expect(so.allowedActions).toContain('requestApproval');
    });
  });

  describe('B · Enquiry → quotation → sales order', () => {
    it('numbers the enquiry monthly, quotes, releases and transfers', async () => {
      const lookups = await api.get<{ types: { code: string }[]; sources: { code: string }[] }>('sales/lookups/enquiry-types', 'AR');
      let r = await api.call('POST', 'sales/enquiries', 'AR', {
        customerCode: 'C-0102', branchCode: 'HQ', enquiryTypeCode: lookups.types[0]!.code, sourceCode: lookups.sources[0]!.code,
        description: 'Six bar stools for the pool bar', items: [{ itemCode: 'CH-BAR-01', qty: '6' }], forward: true,
      });
      expect(r).toMatchObject({ status: 201, body: { docNo: 'EQ-2609-0011', status: 'FORWARDED' } });
      r = await api.call('POST', `sales/enquiries/${r.body.id}/quotation`, 'AR', { version: r.body.version });
      expect(r).toMatchObject({ status: 201, body: { docNo: 'QT-0013', status: 'DRAFT', totals: { total: '1254.00' } } });
      r = await api.call('POST', `sales/quotations/${r.body.id}/release`, 'AR', { version: r.body.version });
      expect(r).toMatchObject({ status: 201, body: { status: 'RELEASED', validUntil: '2026-10-13' } });
      r = await api.call('POST', `sales/quotations/${r.body.id}/transfer`, 'AR', { version: r.body.version });
      expect(r).toMatchObject({ status: 201, body: { orderNo: 'SO-0009' } });
      const so = await api.get(`sales/orders/${r.body.orderId}`, 'AR');
      expect(so.status).toBe('DRAFT');
      const released = await api.call('POST', `sales/orders/${so.id}/release`, 'AR', { version: so.version });
      expect(released).toMatchObject({ status: 201, body: { status: 'RELEASED' } });
      expect((await salesDoc('enquiries', 'EQ-2609-0011')).status).toBe('QUOTED');
    });
  });

  describe('C · Quotation discount, revise, lost', () => {
    it('needs the Sales Manager for a 20% discount', async () => {
      let qt = await salesDoc('quotations', 'QT-0012', 'LWJ');
      const lines = qt.lines.map((l: any) => ({ itemCode: l.itemCode, qty: l.qty ?? l.orderedQty, unitPrice: l.unitPrice, discountPct: l.lineNo === 1 ? '20' : l.discountPct }));
      let r = await api.call('PATCH', `sales/quotations/${qt.id}`, 'LWJ', { version: qt.version, lines });
      expect(r).toMatchObject({ status: 200, body: { totals: { total: '84623.00' } } });
      qt = r.body;
      r = await api.call('POST', `sales/quotations/${qt.id}/release`, 'LWJ', { version: qt.version });
      expect(r).toMatchObject({ status: 409, body: { message: 'A discount of 20% is above the 15% limit. Request approval first.' } });
      r = await api.call('POST', `sales/quotations/${qt.id}/request-approval`, 'LWJ', { version: qt.version, reason: 'Reseller opening two showrooms' });
      expect(r).toMatchObject({ status: 201, body: { status: 'PENDING_APPROVAL' } });
      expect((await api.call('POST', `sales/approvals/${await approvalId('NA', 'QT-0012')}/approve`, 'NA', { comment: 'One-off' })).status).toBe(201);
      qt = await api.get(`sales/quotations/${qt.id}`, 'LWJ');
      expect((await api.call('POST', `sales/quotations/${qt.id}/release`, 'LWJ', { version: qt.version })).body.status).toBe('RELEASED');
    });

    it('revises under the same number and asks a reason for lost', async () => {
      const q4 = await salesDoc('quotations', 'QT-0004', 'FO');
      const rev = await api.call('POST', `sales/quotations/${q4.id}/revise`, 'FO', { version: q4.version });
      expect(rev).toMatchObject({ status: 201, body: { docNo: 'QT-0004', revision: 1, status: 'DRAFT' } });
      const q10 = await salesDoc('quotations', 'QT-0010', 'FO');
      expect((await api.call('POST', `sales/quotations/${q10.id}/lost`, 'FO', { version: q10.version })).status).toBe(400);
      const lost = await api.call('POST', `sales/quotations/${q10.id}/lost`, 'FO', { version: q10.version, reason: 'Customer chose a cheaper local maker' });
      expect(lost.body.status).toBe('LOST');
    });
  });

  describe('D · Cancel the undelivered balance', () => {
    it('lets only the Sales Manager release CO-0002, and Purchase drops the cancelled chairs', async () => {
      const co = await salesDoc('cancel-orders', 'CO-0002', 'FO');
      expect(await api.call('POST', `sales/cancel-orders/${co.id}/release`, 'FO', { version: co.version })).toMatchObject({
        status: 403, body: { message: 'Your role cannot do this. Permission needed: sales.cancel_order.release.' },
      });
      expect((await api.call('POST', `sales/cancel-orders/${co.id}/release`, 'NA', { version: co.version })).body.status).toBe('RELEASED');
      expect(await salesDoc('orders', 'SO-0006')).toMatchObject({ status: 'DONE', statusLabel: 'Balance cancelled' });
      await api.until('SO-0006 cancelled in Purchase demand', async () =>
        (await api.prisma.purSalesDemand.findFirst({ where: { soNo: 'SO-0006', cancelledQty: { gt: 0 } } }))?.cancelledQty.eq(15));
    });
  });

  describe('E · Invoice below the price list and over the credit limit', () => {
    it('goes to Nor Azlina for the price, then Rosnah Ismail for credit, then releases', async () => {
      expect((await api.call('POST', `sales/approvals/${await approvalId('NA', 'INV-0003')}/approve`, 'NA', { comment: 'ok, clinic volume' })).status).toBe(201);
      let inv = await salesDoc('invoices', 'INV-0003', 'FO');
      expect(inv.status).toBe('PENDING_APPROVAL');
      expect((await api.call('POST', `sales/approvals/${await approvalId('RI', 'INV-0003')}/approve`, 'RI', { comment: 'Within reach once CO-0002 is out' })).status).toBe(201);
      inv = await api.get(`sales/invoices/${inv.id}`, 'FO');
      expect(inv.allowedActions).toContain('release');
      const r = await api.call('POST', `sales/invoices/${inv.id}/release`, 'FO', { version: inv.version });
      expect(r).toMatchObject({ status: 201, body: { status: 'RELEASED', payment: { key: 'UNPAID' }, amounts: { balance: '2904.00' }, dueDate: '2026-10-29' } });
    });
  });

  describe('F · Deposit → delivery hold → deliver → invoice uses the deposit', () => {
    it('holds delivery until the deposit is paid', async () => {
      const pf = await salesDoc('proformas', 'PF-0004', 'AR');
      expect((await api.call('POST', `sales/proformas/${pf.id}/release`, 'AR', { version: pf.version })).body.status).toBe('SENT');
      const overview = await api.get<{ waiting: { orderNo: string; state: string }[] }>('sales/deliveries/overview', 'AR');
      expect(overview.waiting.find((w) => w.orderNo === 'SO-0007')!.state).toBe('DEPOSIT');
      const delivery = await salesDoc('deliveries', 'DO-0003', 'AR');
      expect(await api.call('POST', `sales/deliveries/${delivery.id}/confirm`, 'AR', { version: delivery.version })).toMatchObject({
        status: 409, body: { message: 'Delivery of SO-0007 is on hold until the deposit on PF-0004 (RM 11,088.00) is paid.' },
      });
      const paid = await api.call('POST', 'dev/finance/receipts', 'AR', { appliesToType: 'PROFORMA', appliesToNo: 'PF-0004', customerCode: 'C-0102', amount: '11088.00' });
      expect(paid.status).toBe(201);
      expect(await api.get(`sales/proformas/${pf.id}`)).toMatchObject({ status: 'PAID', received: '11088.00' });
      const again = await api.get(`sales/deliveries/${delivery.id}`, 'AR');
      expect((await api.call('POST', `sales/deliveries/${delivery.id}/confirm`, 'AR', { version: again.version })).body.status).toBe('CONFIRMED');
      expect((await salesDoc('orders', 'SO-0007')).status).toBe('DONE');
      await api.until('SO-0007 delivered in Purchase demand', async () =>
        (await api.prisma.purSalesDemand.findFirst({ where: { soNo: 'SO-0007' } }))?.deliveredQty.eq(24));
    });

    it('uses the deposit once, on the order invoice', async () => {
      const so = await salesDoc('orders', 'SO-0007', 'AR');
      let r = await api.call('POST', 'sales/invoices/from-order', 'AR', { salesOrderId: so.id, lines: so.lines.map((l: any) => ({ soLineId: l.id, qty: '24' })) });
      expect(r).toMatchObject({ status: 201, body: { docNo: 'INV-0004', status: 'DRAFT', amounts: { pendingDeposit: { proformaNo: 'PF-0004', amount: '11088.00' } } } });
      r = await api.call('POST', `sales/invoices/${r.body.id}/release`, 'AR', { version: r.body.version });
      expect(r).toMatchObject({ status: 201, body: { amounts: { total: '36960.00', deposit: '11088.00', balance: '25872.00' } } });
      expect((await salesDoc('proformas', 'PF-0004')).label).toBe('Used on INV-0004');
    });
  });

  describe('G, H, I · Return, debit note, cash sale', () => {
    it('returns goods only through the store, and lowers the invoice balance', async () => {
      const sr = await salesDoc('returns', 'SR-0002', 'AR');
      expect((await api.call('POST', `sales/returns/${sr.id}/release`, 'FO', { version: sr.version })).status).toBe(403);
      expect((await api.call('POST', `sales/returns/${sr.id}/release`, 'AR', { version: sr.version })).body.status).toBe('RELEASED');
      expect(await salesDoc('invoices', 'INV-0002')).toMatchObject({ amounts: { balance: '5610.00' }, payment: { label: 'Unpaid · credited' } });
    });

    it('adds a debit note with service tax to the invoice', async () => {
      const dn = await salesDoc('debit-notes', 'DN-0001', 'AR');
      const r = await api.call('POST', `sales/debit-notes/${dn.id}/release`, 'AR', { version: dn.version });
      expect(r).toMatchObject({ status: 201, body: { status: 'RELEASED', totals: { total: '378.00' } } });
      expect((await salesDoc('invoices', 'INV-0001')).amounts.balance).toBe('15503.00');
    });

    it('takes payment and releases the counter sale', async () => {
      const cs = await salesDoc('cash-sales', 'CS-0004', 'SC1');
      expect((await api.call('POST', `sales/cash-sales/${cs.id}/release`, 'SC1', { version: cs.version })).body.status).toBe('RELEASED');
    });
  });

  describe('J · Buy to order with Purchase', () => {
    const poDoc = async (docNo: string) => api.get(`purchase/orders/${await api.idOf('purchase/orders', docNo, 'LMY')}`, 'LMY');
    const purchaseApprove = async (docNo: string) => {
      const inbox = await api.get<{ items: { id: string; docNo: string }[] }>('purchase/approvals', 'AZ');
      return api.call('POST', `purchase/approvals/${inbox.items.find((i) => i.docNo === docNo)!.id}/approve`, 'AZ', { comment: 'ok' });
    };
    const receive = async (poId: string, qtys: string[], supplierDoNo: string) => {
      const t = await api.get(`purchase/receipts/new?poId=${poId}`, 'RAH');
      const draft = await api.call('POST', 'purchase/receipts', 'RAH', {
        poId, warehouseCode: 'HQ-MAIN', supplierDoNo,
        lines: qtys.map((q, i) => ({ poLineId: t.lines[i].poLineId, receivedQty: q, locationCode: 'HQ-MAIN/B-01' })),
      });
      return api.call('POST', `purchase/receipts/${draft.body.id}/confirm`, 'RAH', { version: draft.body.version });
    };
    const releaseWithCreditApproval = async (so: any) => {
      const first = await api.call('POST', `sales/orders/${so.id}/release`, 'AR', { version: so.version });
      expect(first).toMatchObject({ status: 409, body: { code: 'CREDIT_APPROVAL_REQUIRED' } });
      await api.call('POST', `sales/orders/${so.id}/request-approval`, 'AR', { version: so.version, reason: 'Hotel refurbishment, deposit agreed' });
      await api.call('POST', `sales/approvals/${await approvalId('NA', so.docNo)}/approve`, 'NA', { comment: 'ok' });
      const fresh = await api.get(`sales/orders/${so.id}`, 'AR');
      return api.call('POST', `sales/orders/${so.id}/release`, 'AR', { version: fresh.version });
    };
    const btoOrder = async (qty: string) =>
      (await api.call('POST', 'sales/orders', 'AR', { customerCode: 'C-0012', orderTypeCode: 'BTO', deliveryWantedBy: '2026-11-15', lines: [{ itemCode: 'SF-CUS-03', qty, unitPrice: '3200' }] })).body;

    it('shows SO-0003 as received once Purchase receives PO-0003', async () => {
      expect((await purchaseApprove('PO-0003')).status).toBe(201);
      const po = await poDoc('PO-0003');
      expect((await api.call('POST', `purchase/orders/${po.id}/release`, 'LMY', { version: po.version })).body.status).toBe('RELEASED');
      expect((await receive(po.id, ['20'], 'PKT-DO-2001')).body).toMatchObject({ status: 'CONFIRMED', docNo: 'GRN-0004' });
      const line = await api.until('SO-0003 received', async () => (await salesDoc('orders', 'SO-0003', 'AR')).lines[0].purchase?.state === 'RECEIVED' && (await salesDoc('orders', 'SO-0003', 'AR')).lines[0]);
      expect(line.purchase.label).toBe('PO-0003 · received');
      const overview = await api.get<{ waiting: { orderNo: string; state: string }[] }>('sales/deliveries/overview', 'AR');
      expect(overview.waiting.find((w) => w.orderNo === 'SO-0003')!.state).toBe('READY');
      const grnEvent = await api.prisma.sysOutbox.findFirstOrThrow({ where: { name: 'purchase.goods.received' }, orderBy: { seq: 'desc' } });
      expect(grnEvent.status).toBe('PENDING');
    });

    it('drafts a PO for a new buy-to-order line, then follows its receipt and cancellation', async () => {
      const so = await btoOrder('2');
      expect(so.docNo).toBe('SO-0010');
      expect((await releaseWithCreditApproval(so)).body.status).toBe('RELEASED');
      const answer = await api.until('Purchase answer for SO-0010', async () =>
        (await api.prisma.sysOutbox.findMany({ where: { name: 'purchase.buy_to_order.handled' } })).find((e) => (e.payload as any).soNo === 'SO-0010'));
      expect((answer.payload as any).lines).toEqual([{ soLineNo: 1, itemCode: 'SF-CUS-03', poNo: 'PO-0007', problem: null }]);

      const list = await api.get<{ items: { docNo: string; source: { label: string } }[] }>('purchase/orders?q=PO-0007', 'LMY');
      expect(list.items[0]!.source.label).toBe('SO-0010 · auto');
      const po = await poDoc('PO-0007');
      expect(po).toMatchObject({ status: 'DRAFT', supplier: { code: 'S-0047' }, buyer: { code: 'LMY' }, totals: { total: '4620.00' }, remarks: 'Buy to order for SO-0010. Contract price, no RFQ needed.' });
      expect(po.lines.map((l: any) => l.unitPrice)).toEqual(['2100.0000']);
      await api.until('SO-0010 line shows PO-0007', async () => (await api.get(`sales/orders/${so.id}`, 'AR')).lines[0].purchase?.label === 'PO-0007');
      const released = await api.prisma.sysOutbox.findFirstOrThrow({ where: { name: 'sales.order.released', aggregateId: so.id } });
      expect(released.status).toBe('PENDING');
      expect((await demand()).lines.find((l) => l.itemCode === 'SF-CUS-03')!.salesOrders.map((s) => s.soNo)).toContain('SO-0010');

      expect((await api.call('POST', `purchase/orders/${po.id}/release`, 'LMY', { version: po.version })).body.status).toBe('RELEASED');
      await receive(po.id, ['1'], 'PKT-DO-2002');
      await api.until('1 of 2 received', async () => (await api.get(`sales/orders/${so.id}`, 'AR')).lines[0].purchase?.label === 'PO-0007 · 1 of 2 received');
      const t = await api.get(`purchase/cancel-orders/new?poId=${po.id}`, 'LMY');
      const pco = await api.call('POST', 'purchase/cancel-orders', 'LMY', { poId: po.id, reason: 'Supplier cannot make the last one', lines: [{ poLineId: t.lines[0].poLineId, cancelQty: '1' }] });
      expect((await api.call('POST', `purchase/cancel-orders/${pco.body.id}/release`, 'AZ', { version: pco.body.version })).body.status).toBe('RELEASED');
      await api.until('Purchase cancelled 1', async () => (await api.get(`sales/orders/${so.id}`, 'AR')).lines[0].purchase?.label === 'PO-0007 · Purchase cancelled 1 PCS');
    });

    it('drafts nothing when the Purchase switch is off, and says why', async () => {
      await api.prisma.purSetting.updateMany({ data: { autoDraftBuyToOrder: false } });
      try {
        const so = await btoOrder('1');
        expect((await releaseWithCreditApproval(so)).body.status).toBe('RELEASED');
        const line = await api.until('NO_PO answer', async () => {
          const l = (await api.get(`sales/orders/${so.id}`, 'AR')).lines[0];
          return l.purchase?.state === 'NO_PO' ? l : null;
        });
        expect(line.purchase.label).toBe('No PO yet: Auto-draft for buy-to-order lines is off in Purchase. The buyer raises the PO by hand.');
        expect(await api.prisma.purPurchaseOrder.count({ where: { salesOrderNo: so.docNo } })).toBe(0);
      } finally {
        await api.prisma.purSetting.updateMany({ data: { autoDraftBuyToOrder: true } });
      }
    });
  });
});
