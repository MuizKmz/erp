# Events between modules

Modules never call each other’s tables. When something happens that another module cares about, the module writes an **event** to the outbox table (`sys_outbox`) in the same database transaction as the change. A dispatcher then delivers it. If the receiving module is not built or not connected yet, the event simply waits — nothing is lost and the user is never blocked.

## Naming

`<module>.<document>.<what happened>` in past tense, lower case: `purchase.order.released`.

## Envelope (every event)

```json
{
  "id": "uuid",
  "name": "purchase.order.released",
  "version": 1,
  "tenantId": "uuid",
  "occurredAt": "2026-09-23T03:02:00Z",
  "actor": { "userCode": "LMY" },
  "correlationId": "uuid",
  "payload": { }
}
```

Payloads carry **codes and snapshots**, not internal IDs only: document number, branch code, supplier/customer code, and per line `itemCode`, `uomCode`, `qty`, `warehouseCode`. Quantities and money are strings (`"95.0000"`, `"4180.00"`).

## Purchase publishes

| Event | When | Main payload | Who will listen |
|---|---|---|---|
| `purchase.request.submitted` | PRQ submitted | prqNo, lines | — |
| `purchase.order.released` | PO released | poNo, supplierCode, expectedDate, warehouseCode, lines | WMS (expected receipts), Finance (commitments) |
| `purchase.order.balance_cancelled` | PCO released | poNo, lines cancelled | WMS, Sales (buy-to-order) |
| `purchase.goods.received` | GRN confirmed | grnNo, poNo, supplierDo, lines with warehouse/location | Inventory / WMS (stock in), Sales (buy-to-order ready) |
| `purchase.invoice.approved` | PI approved | piNo, supplierInvoiceNo, amounts, dueDate | Finance (payable) |
| `purchase.return.released` | PRT released | prtNo, grnNo, lines | Inventory / WMS (stock out), Finance (credit expected) |
| `purchase.debit_note.released` | PDN released | pdnNo, piNo, amount | Finance |
| `purchase.cash_purchase.released` | CP released | cpNo, paidBy, lines | Inventory / WMS, Finance |

## Purchase listens to

| Event | From | What Purchase does |
|---|---|---|
| `sales.order.released` | Sales | For buy-to-order lines, drafts a PO linked to the sales order |
| `mdm.item.updated`, `mdm.supplier.updated` | Master Data | Refresh read cache. Never changes existing documents |
| `wms.goods.received` | WMS (later) | Creates and confirms the GRN automatically; the GRN screen becomes read-only |
| `mes.material.required` | MES (later) | Adds a line to the demand list |
| `finance.payment.made` | Finance (later) | Marks the purchase invoice Paid |

## Sales publishes (for later)

`sales.order.released`, `sales.order.balance_cancelled`, `sales.shipment.requested`, `sales.invoice.released`, `sales.return.released`, `sales.debit_note.released`, `sales.cash_sale.released`.

## Rules for the dispatcher

- Deliver at least once; every consumer must be idempotent (store processed event ids).
- Retry with backoff; after 10 failures mark the event `FAILED` so someone can see it.
- Phase 1: an in-process poller (`@nestjs/schedule`) every few seconds. Later: Redis/BullMQ as in the SDD.
