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
  "aggregateType": "PUR_ORDER",
  "aggregateId": "uuid",
  "payload": { }
}
```

Payloads carry **codes and snapshots**, not internal IDs only: document number, branch code, supplier/customer code, and per line `itemCode`, `uomCode`, `qty`, `warehouseCode`. Quantities and money are strings (`"95.0000"`, `"4180.00"`). Dates are `"2026-09-29"`.

## Two kinds of consumer

| | Receiving system | Module listener |
|---|---|---|
| Who | Inventory/WMS, Finance, LHDN e-Invoice (not connected yet) | Another ERP module that reacts too: Purchase ↔ Sales |
| Registered with | `OutboxConsumers.subscribe(event, handler, fn)` | `OutboxConsumers.listen(event, handler, fn)` |
| Effect on the event | Delivery marks it `DISPATCHED` | Never changes its status |
| Progress kept in | `sys_event_handled` (event id + handler) | `sys_event_handled` (event id + handler) |

Screens read the event status to say "Inventory is not connected yet" or "Accounting posting: queued". A module listener must not change that, so `purchase.goods.received` stays queued for Inventory even after Sales has used it.

## Purchase publishes

| Event | When | Main payload | Who listens |
|---|---|---|---|
| `purchase.request.submitted` | PRQ submitted | prqNo, lines | — |
| `purchase.order.released` | PO released | poNo, supplierCode, expectedDate, warehouseCode, lines | WMS (expected receipts), Finance (commitments) — later |
| `purchase.order.balance_cancelled` | PCO released | pcoNo, poNo, supplierCode, salesOrderNo, poStatus, value, lines (itemCode, uomCode, qty) | **Sales** (buy-to-order status); WMS later |
| `purchase.goods.received` | GRN confirmed | grnNo, poNo, supplierCode, supplierDo, branchCode, receivedDate, salesOrderNo, lines with condition, warehouse and location | **Sales** (buy-to-order status); Inventory / WMS (stock in) later |
| `purchase.buy_to_order.handled` | Purchase has answered a `sales.order.released` with buy-to-order lines | soNo, autoDraft, lines (soLineNo, itemCode, poNo or null, problem or null) | **Sales** (PO number on the order line) |
| `purchase.invoice.approved` | PI approved | piNo, supplierInvoiceNo, amounts, dueDate | Finance (payable) — later |
| `purchase.return.released` | PRT released | prtNo, grnNo, lines | Inventory / WMS (stock out), Finance (credit expected) — later |
| `purchase.debit_note.released` | PDN released | pdnNo, piNo, amount | Finance — later |
| `purchase.cash_purchase.released` | CP released | cpNo, paidBy, lines | Inventory / WMS, Finance — later |

## Purchase listens to

| Event | From | What Purchase does |
|---|---|---|
| `sales.order.released` | Sales | **Buy-to-order:** if “Auto-draft a PO for buy-to-order sales lines” is on, drafts one PO per preferred supplier (contract price, else last price), created by System for the branch buyer and linked to the sales order. Lines sold in another unit than Purchase buys in are left to the buyer. Always answers with `purchase.buy_to_order.handled`. **Demand:** adds the order's lines to `pur_sales_demand`, Purchase's copy of open sales-order needs (P04, P06) |
| `sales.shipment.requested` | Sales | Lowers the open quantity in `pur_sales_demand`, by the sales-order line (`soLineNo`) |
| `sales.order.balance_cancelled` | Sales | Lowers the open quantity in `pur_sales_demand`, by the sales-order line (`lineNo`) |
| `wms.goods.received` | WMS (later) | Creates and confirms the GRN automatically; the GRN screen becomes read-only |
| `mes.material.required` | MES (later) | Adds a line to the demand list |
| `finance.payment.made` | Finance (later) | Marks the purchase invoice Paid |

## Sales publishes

| Event | When | Main payload | Who listens |
|---|---|---|---|
| `sales.order.released` | SO released | soNo, docDate, branchCode, customerCode, customerName, total, deliveryWantedBy, warehouseCode, lines (lineNo, itemCode, uomCode, qty, isBuyToOrder) | **Purchase** (buy-to-order PO, demand) |
| `sales.order.balance_cancelled` | Cancel order released | cancelNo, soNo, branchCode, warehouseCode, customerCode, reason, orderClosed, lines (lineNo = sales-order line, itemCode, uomCode, qty, isBuyToOrder, purchaseOrderNo) | **Purchase** (demand); Purchase is also warned for buy-to-order lines |
| `sales.shipment.requested` | DO confirmed | doNo, soNo, branchCode, warehouseCode, customerCode, deliverTo, vehicle, driver, consignmentNote, lines (lineNo = DO line, soLineNo = sales-order line, itemCode, uomCode, qty) | **Purchase** (demand); Inventory (stock out) later |
| `sales.invoice.released` | Invoice released | invoiceNo, docDate, dueDate, branchCode, customer code, name and TIN, currency, subtotal, discountTotal, taxTotal, rounding, total, salesOrderNo, deliveryNos, depositApplied, proformaNo, lines | Finance (receivable), LHDN e-Invoice — later |
| `sales.return.released` | Sales return released | returnNo, invoiceNo, customerCode, branchCode, reason, stockIn (goodsTo, warehouseCode, locationCode), creditNote (method, amounts, originalInvoiceNo), lines | Inventory (stock in), Finance and LHDN (credit note) — later |
| `sales.debit_note.released` | Debit note released | debitNoteNo, invoiceNo, customerCode, branchCode, reason, dueDate, subtotal, taxTotal, total, lines | Finance, LHDN — later |
| `sales.cash_sale.released` | Cash sale released | saleNo, docDate, branchCode, warehouseCode, customerCode, payment (method, reference, received, change, total), eInvoice (OWN with buyer name and TIN, or CONSOLIDATED with its due date), totals, lines | Finance (receipt), Inventory (stock out), LHDN — later |

## Sales listens to

| Event | From | What Sales does |
|---|---|---|
| `purchase.buy_to_order.handled` | Purchase | Puts the PO number on each buy-to-order order line, or the reason there is none, and writes it in the order's activity |
| `purchase.goods.received` | Purchase | Adds the received quantity to the order lines on that PO (`purchaseReceivedQty`); received but not delivered goods count as ready on the delivery waiting list |
| `purchase.order.balance_cancelled` | Purchase | Adds the cancelled quantity to the order lines on that PO (`purchaseCancelledQty`), counting only what the order is short |
| `mdm.customer.created` | Core | When the payload names an enquiry (`enquiryNo`) that has no customer yet, links it to the new customer so it can be quoted, and writes that in the enquiry's activity (Phase 3 decision 7) |

Sales never bumps the order's version for these: they are Purchase's facts, not edits.

## Core publishes

Purchase and Sales read master data through `MasterDataPort` and keep no copy, so they need none of these events. The exception is Sales' prospect link. Documents keep their snapshots whatever changes. Payloads carry the code, the record after the change and the list of changed fields.

| Event | When | Main payload | Who listens |
|---|---|---|---|
| `mdm.item.created` / `mdm.item.updated` | Item saved, including status changes | code, item, changedFields | WMS, MES — later |
| `mdm.customer.created` / `mdm.customer.updated` | Customer saved | code, customer, changedFields; `created` may carry enquiryNo | **Sales** (`created` with enquiryNo: links the enquiry's prospect); WMS (outbound), Finance — later |
| `mdm.supplier.created` / `mdm.supplier.updated` | Supplier saved, including its contract prices | code, supplier, changedFields | WMS (inbound), Finance — later |
| `mdm.price_list.updated` | Price list or its prices saved | code, price list, changedFields | — |
| `mdm.tax_code.updated` | Tax rate added or changed | code, rates, changedFields | Finance — later |
| `mdm.uom.updated`, `mdm.warehouse.updated` | Unit or warehouse saved | code, record, changedFields | WMS, MES — later |
| `mdm.<record>.deleted` | A record that nothing used was deleted | code, the record as it was | WMS, MES — later |

## Listener names

Stored in `sys_event_handled.handler`. The seed marks its own history as handled under these names, in the same transaction as the seeded events, so a running API never replays it.

| Listener | Event |
|---|---|
| `purchase.draft-po-for-buy-to-order` | `sales.order.released` |
| `purchase.sales-demand-order` | `sales.order.released` |
| `purchase.sales-demand-shipped` | `sales.shipment.requested` |
| `purchase.sales-demand-cancelled` | `sales.order.balance_cancelled` |
| `sales.buy-to-order-po` | `purchase.buy_to_order.handled` |
| `sales.buy-to-order-received` | `purchase.goods.received` |
| `sales.buy-to-order-cancelled` | `purchase.order.balance_cancelled` |
| `sales.prospect-link` | `mdm.customer.created` |

## Rules for the dispatcher

- Deliver at least once; every consumer must be idempotent. Each (event, handler) is recorded in `sys_event_handled` in the same transaction as the handler's own changes, so a redelivery is a no-op.
- Receiving systems: the event is claimed with `FOR UPDATE SKIP LOCKED`; a failure is retried with backoff (5 s, doubling, at most 1 hour); after 10 failures the event is marked `FAILED` so someone can see it. Events nobody subscribes to stay `PENDING`.
- Module listeners: the next event is found with a plain read, then only that event is locked and checked again, so two API instances never handle it twice and user transactions writing new events are never held up. A failure is retried with the same backoff; after 10 failures the event is parked for that listener and an error is logged (kept in memory in phase 1, at most 200 per listener, so a restart tries again).
- A listener that needs something not there yet (a delivery for an order whose release has not been handled) refuses the event, so it is retried later.
- Delivery to receiving systems and to module listeners have separate budgets per round, so a backlog in one never holds up the other.
- Phase 1: an in-process poller (`@nestjs/schedule`) every `OUTBOX_INTERVAL_MS` (5 s), switched by `OUTBOX_DISPATCH`. Later: Redis/BullMQ as in the SDD.
