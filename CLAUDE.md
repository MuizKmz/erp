# Zora Pro ERP — build guide for Claude Code

We are building a modular ERP. **Phase 1 = the module launcher and the Purchase module** (done, steps 0–10). **Phase 2 = the Sales module** (section *Phase 2 · Sales module*, done, steps S0–S10). **Phase 3 = the Core module (Master Data)** (section *Phase 3 · Core module*, done, steps C0–C8). **Phase 4 = Configuration** (section *Phase 4 · Configuration*, in progress, steps A0–A8): company, branches, users, roles and sign-in. Purchase, Sales and Core are working apps with a real API and database (no login until Phase 4 · A5). Read this file fully before writing code, then read the docs it points to.

## Must-read docs

| File | Why |
|---|---|
| `docs/design/SCREENS.md` | Every screen: mockup file, route, API |
| `docs/design/mockups/*.html` + `docs/design/screenshots/*.png` | The approved design. Open the HTML or view the PNG before building a screen |
| `docs/design/mockups/PurUxGuide.html`, `FlowP1–P7.html` | Purchase rules and journeys. Each flow’s *Step by step* table is the acceptance criteria |
| `docs/design/SEED_DATA.md` | Exact demo data. After seeding, screens must show the same numbers as the mockups |
| `docs/design/mockups/SalesUxGuide.html`, `SalesNavMap.html`, `FlowS1–S6.html` | Sales rules and journeys. Each flow’s *Step by step* table is the acceptance criteria |
| `docs/design/SALES_SEED_DATA.md` | Exact Sales demo data, and the mockup conflicts with the choice made |
| `docs/design/CORE_SEED_DATA.md` | Core master data as seeded, and the choices made in the Core mockups |
| `docs/design/CONFIG_SEED_DATA.md` | Company, branches, users, starter roles and sign-in settings as seeded, and the choices made in the Configuration mockups |
| `docs/design/DESIGN_TOKENS.md` | Colours, type, chips, buttons |
| `docs/integration/MASTER_DATA_CONTRACT.md` | What Purchase reads from Master Data and how |
| `docs/integration/EVENTS.md` | Events each module publishes and listens to, and the dispatcher rules |
| `docs/requirements/ERP_SRS.md`, `ERP_SDD.md` | Full requirements and architecture. Long; search them when you need detail |

**If this file and the SDD disagree, this file wins.** Differences from the SDD on purpose: MySQL instead of PostgreSQL, Vue instead of React, no Redis yet, simpler folder layout for phase 1 (rules kept in pure `*.rules.ts` files so they can move into a domain layer later), and document numbers assigned on first save (the mockups show numbers on drafts).

## Stack

- **Backend:** Node 22, NestJS 11, TypeScript strict, Prisma, MySQL 8 (utf8mb4).
- **Frontend:** Vue 3 + Vite + TypeScript, based on the user’s **TailAdmin Vue Pro 2.0.1** template (Tailwind 4), PrimeVue 4 for heavy widgets (DataTable, Select/AutoComplete, DatePicker, Dialog, Toast), `lucide-vue-next` icons. Keep the template’s `package.json` dependencies.
- **OS:** Windows. Give commands for PowerShell. The project path contains a space — always quote it: `"C:\Users\user\Desktop\ERP\Source Code"`.

## Repository layout

```
Source Code/
├─ CLAUDE.md
├─ docs/                      design, integration, requirements (read-only reference)
├─ backend/                   NestJS API on http://localhost:3000, prefix /api/v1
│  ├─ prisma/schema.prisma    one schema, table prefixes per module
│  ├─ prisma/seed.ts          seeds docs/design/SEED_DATA.md, SALES_SEED_DATA.md, CORE_SEED_DATA.md and CONFIG_SEED_DATA.md
│  ├─ test/                   end-to-end journeys: npm run test:e2e (resets the demo data)
│  └─ src/
│     ├─ platform/            shared building blocks, no business rules
│     │  ├─ prisma/           PrismaService
│     │  ├─ context/          current user, tenant, branch (dev header for now)
│     │  ├─ numbering/        NumberingService (locks the sequence row)
│     │  ├─ activity/         ActivityService → sys_activity
│     │  ├─ approvals/        generic approval requests
│     │  ├─ outbox/           OutboxWriter + dispatcher (polls; receiving systems and module listeners)
│     │  ├─ attachments/      local file storage under backend/uploads
│     │  └─ http/             list query DTO, list response, error filter
│     ├─ master-data/         MasterDataPort (interface) + Prisma adapter, READ ONLY
│     └─ purchase/
│        ├─ purchase.module.ts
│        ├─ shared/           statuses, totals.rules.ts, approval-limit.rules.ts, match.rules.ts (+ .spec.ts)
│        └─ requests/ rfqs/ orders/ receipts/ cancel-orders/ invoices/
│           cash-purchases/ debit-notes/ returns/ approvals/ demand/ dashboard/ settings/
│           sales-link/ (listens to Sales events: buy-to-order POs, pur_sales_demand)
│           each: <name>.controller.ts, <name>.service.ts, dto/, <name>.rules.ts (+ .spec.ts)
└─ frontend/                  TailAdmin Vue Pro base, http://localhost:5173
   └─ src/
      ├─ assets/erp-theme.css         tokens from DESIGN_TOKENS.md
      ├─ api/http.ts                  fetch wrapper (VITE_API_URL, x-dev-user header, errors → toast)
      ├─ composables/useListPage.ts   filters + status tab + page, synced to the URL query
      ├─ components/erp/              shared ERP components (list below)
      ├─ modules/launcher/LauncherView.vue
      └─ modules/purchase/            router.ts, menu.ts, types.ts, api/, views/ (one view per P-code)
```

## Module boundaries (do not break)

1. Sales and Purchase are separate modules. `purchase/` never imports from `sales/` and the reverse.
2. A module only reads and writes its own tables. Shared data comes from `MasterDataPort`; cross-module effects go out as outbox events.
3. Purchase never writes `mdm_` tables and never queries them directly — only through `MasterDataPort`. The adapter reads the local `mdm_` tables, which the Core module maintains since Phase 3; later it will call the real Master Data API, and nothing in `purchase/` may need to change.
4. Stock on hand comes from a read-only stub (`inv_stock_snapshot`) until Inventory/WMS is connected. Sales-order demand comes from Purchase's own copy (`pur_sales_demand`), kept from Sales events (`EVENTS.md`).
5. When another module is not connected, never block the user: save the event and show the amber banner (“Inventory is not connected yet…”).

## Database conventions (MySQL + Prisma)

- One database `zora_erp`. Table prefixes via `@@map`: `sys_` platform, `mdm_` master data (written only by Core since Phase 3, and by the seed), `inv_` and `fin_` stubs, `pur_` purchase, `sal_` sales. Prisma model names: `PurPurchaseOrder` → `@@map("pur_purchase_order")`.
- IDs: `String @id @default(uuid()) @db.Char(36)`. Every table has `tenantId` (one tenant seeded) and an index starting with it.
- Money `Decimal(18,2)`, unit price `Decimal(18,4)`, quantity `Decimal(18,4)`, rates `Decimal(7,4)`. **Never use JS floats for money or quantity.** Calculate with `Prisma.Decimal` on the server; send as strings in JSON.
- Rounding: line amount = round(qty × price, 2); line tax = round(amount × rate, 2); header totals = sums of lines.
- Documents have: `docNo` (unique per tenant + type), `docDate`, `status` (Prisma enum), `branchCode`, `remarks`, `version` (optimistic lock), `createdAt/By`, `updatedAt/By`, `isMigrated`.
- Lines keep references **and snapshots**: `itemId`, `itemCode`, `itemName`, `uomCode`, `taxCode`, `taxRate`, `unitPrice`.
- PO lines carry running quantities: `orderedQty`, `receivedQty`, `billedQty`, `returnedQty`, `cancelledQty`, updated in the same transaction as the document that changes them.
- Links between documents: natural foreign keys (GRN line → PO line, PI line → GRN line …) plus `sys_doc_link` rows to power *Document flow* and *Linked documents*.
- Released documents are never deleted or edited. Drafts may be deleted.
- Every state change, in one transaction: update the document, write `sys_activity`, write `sys_outbox` events.

## API conventions

- REST under `/api/v1/purchase/...` (paths in `SCREENS.md`).
- **List:** `GET ?page=1&pageSize=20&status=&q=&dateFrom=&dateTo=&sort=-docDate` → `{ items, total, page, pageSize, statusCounts: { all, draft, … } }` (status tabs show the counts).
- **Detail:** `GET /:id` → header, lines, totals, `links`, `activity`, and `allowedActions` for the current user. The frontend shows buttons only from `allowedActions`.
- **Actions:** `POST /:id/<action>` (`submit`, `approve`, `reject`, `release`, `confirm`, `award` …) with optional `{ comment }`.
- **Errors:** 400 `{ message, errors: [{ field, message }] }` for validation; 409 `{ code, message }` for broken business rules. Messages are written for users and name the limit, e.g. `Receiving now cannot be more than the open quantity (5).`
- Validation with `class-validator` DTOs; global `ValidationPipe({ whitelist: true, transform: true })`.
- Dates as ISO strings; business timezone `Asia/Kuala_Lumpur`.

## No login yet

*Since Phase 4 · A5 this is dev mode (`AUTH_MODE=dev`), kept for the demo and the tests. `AUTH_MODE=jwt` turns on sign-in; see Phase 4 · Sign-in.*

- Backend: a `DevUserGuard` reads header `x-dev-user` (user code, default `LMY`) when `AUTH_MODE=dev`. Use `@CurrentUser()` everywhere so JWT can replace it later without touching services.
- Put `@RequirePermission('purchase.order.release')` style decorators on actions now; in dev mode they check the user’s seeded roles.
- Frontend: a **Dev user switcher** in the top bar (Lim Mei Ying, Ahmad Zaki, Rahim, Tan Wei Ling, Rosnah Ismail …), saved in localStorage and sent as `x-dev-user`. This is how we test approvals.
- Emails are not sent: write them to `sys_email_log` and show “Sent” in the UI.

## Purchase business rules (enforce on the server, test in `*.rules.spec.ts`)

1. Goods can never be received beyond the open PO quantity (ordered − received − cancelled). Over-receipt switch is off.
2. Supplier invoices are matched against **received** quantity. Tolerance from settings: price ±2%, quantity 0 over received, tax ±RM 1.00. Outside tolerance the user picks: record received only, hold, or accept as billed (needs Purchasing Manager approval).
3. PO approval when submitted: HQ over RM 10,000 → Purchasing Manager; Penang over RM 5,000 → Branch Manager; any branch over RM 50,000 → also Finance Director. Under the limit the buyer releases directly. The buyer can never approve their own PO. A PO is locked while pending.
4. Orders over RM 50,000 need an RFQ with at least 2 supplier replies, unless the item has a contract price.
5. Awarding a supplier that is not the cheapest requires a reason (saved and shown to the approver).
6. Only ACTIVE suppliers and purchasable items can be used.
7. Released documents are locked. Corrections go through Cancel order (unreceived balance), Purchase return (received goods) or Supplier debit note (extra charge).
8. Cancel only the unreceived balance. Buyers draft; only the Purchasing Manager releases (`purchase.cancel_order.release`).
9. Return quantity ≤ received − already returned.
10. Cash purchase: at most RM 1,000.00 per receipt; a receipt photo is required to release.
11. Supplier debit note with a charge that is not on the PO needs Purchasing Manager approval.
12. Document numbers come from `NumberingService` on first save (`PO-0007`), never reused; a deleted draft leaves a gap.

**Statuses**
- Request: DRAFT, SUBMITTED, CONVERTED, REJECTED
- RFQ: DRAFT, WAITING, READY, AWARDED, CLOSED
- Purchase order: DRAFT, PENDING_APPROVAL, RELEASED, PARTIAL, DONE (flag `balanceCancelled`), CANCELLED
- Goods receipt: DRAFT, CONFIRMED · Cash purchase: DRAFT, RELEASED · Cancel order: DRAFT, RELEASED
- Purchase invoice: DRAFT, TO_MATCH, PENDING_APPROVAL, APPROVED, REJECTED, PAID
- Debit note: DRAFT, PENDING_APPROVAL, RELEASED, REJECTED · Return: DRAFT, RELEASED (waiting for credit), SETTLED

## Frontend rules

- Match the mockup for layout, labels, column order, buttons, chips and empty space. Copy wording exactly.
- Build these shared components once in `components/erp/` and reuse them: `ModuleLayout` (sidebar + top bar + breadcrumb, themed by `data-module`), `PageHeader` (title, number, status chip, subtitle, actions), `StatusChip`, `KpiCard`, `FilterBar`, `StatusTabs`, `DataList` (PrimeVue DataTable wrapper), `Pager`, `DocLines`, `TotalsBox`, `SideCard`, `NextSteps`, `ChecksList`, `LinkedDocs`, `ActivityList`, `NoticeBanner`, `MoneyText`, `QtyProgress`, `MasterDataPicker`, `DevUserSwitcher`.
- Module theme by CSS variables (`--mod-side`, `--mod-primary` …) from `DESIGN_TOKENS.md`. Purchase is green, Sales purple. No hard-coded hex in views.
- Codes (item, supplier, warehouse) are always picked from a list (`MasterDataPicker`), never typed free.
- List state (tab, filters, page) lives in the URL query so back/refresh keep it.
- Money and quantities arrive as strings; format with `MoneyText`; don’t do float maths. Previews in forms may calculate, but the server’s totals are the truth.
- Routes carry `meta: { code: 'P09', title: 'Purchase Order', menuGroup: 'transaction' }`; the sidebar and breadcrumb read from it.

## Build order for phase 1 (stop after each step for the user to review)

0. **Check the workspace.** List what is already in `Source Code`. If `frontend/` is missing, ask the user where their TailAdmin Vue Pro copy is (do not download a template). Check `node -v` (22) and that MySQL 8 is running. Create `backend/.env` from `.env.example` (`DATABASE_URL="mysql://root:<password>@localhost:3306/zora_erp"`, `AUTH_MODE=dev`, `PORT=3000`) and `frontend/.env` (`VITE_API_URL=http://localhost:3000/api/v1`). `git init` if needed.
1. **Backend skeleton:** NestJS app, Prisma connected, `/api/v1/health`, platform modules (context, numbering, activity, approvals, outbox, attachments, error filter, list helpers), CORS for 5173.
2. **Schema and seed:** `sys_`, `mdm_`, `inv_`/`sal_` stubs, `pur_` tables. Seed everything in `SEED_DATA.md`. Run `npx prisma migrate dev` and `npx prisma db seed`; print row counts.
3. **Frontend shell:** theme tokens, `ModuleLayout`, Launcher (00), Purchase home (P01) with the dashboard API, Dev user switcher, all Purchase routes registered (placeholder pages for screens not built yet). *Review with the user against the mockups before continuing.*
4. **Purchase orders and approvals:** P09 list, P10 form, P11 approval dialog, P02 approvals inbox. This is the core loop.
5. **Demand and requests:** P04, P05, P06.
6. **RFQ:** P07, P08 (award creates the draft PO).
7. **Goods receipt:** P14, P15.
8. **Supplier invoice and three-way match:** P16, P17.
9. **Fixes and small buys:** P12, P13 cancel order · P22, P23 return · P20, P21 debit note · P18, P19 cash purchase.
10. **Document flow and settings:** P03, P24, P25, P26.

**Definition of done for every step:** the screen matches its mockup; the seeded data shows the same numbers as the mockup; rules have unit tests; `npm run build` passes in backend and `npm run type-check` passes in frontend; a short note tells the user what to click to check it; commit with a clear message.

## Working agreement

- Before each step, write a short plan (files, tables, endpoints). After it, list what changed and how to check it.
- **Ask first** before: adding a dependency not listed here (pre-approved: `@nestjs/config`, `@nestjs/schedule`, `@nestjs/event-emitter`, `prisma`, `@prisma/client`, `class-validator`, `class-transformer`, `pinia`), changing the design or a rule in this file, deleting files, or touching anything outside `Source Code`.
- Do **not** build yet: login/JWT (until Phase 4 · A5), real email sending, LHDN e-Invoice submission, Inventory/Finance/WMS/MES integrations (only their events and stubs).
- Code, identifiers and comments in English. UI text exactly as in the mockups.
- Keep secrets out of git (`.env` in `.gitignore`).

---

# Phase 2 · Sales module

Everything above still applies to Sales (stack, database and API conventions, no login, the working agreement, the definition of done). This section adds what is different or new. **Purchase is finished; do not change Purchase behaviour while building Sales.** If a Sales step seems to need a Purchase change, ask first.

## Must-read for Sales

- **Screen list:** `SCREENS.md` → *Sales module* (S01–S33, routes and mockups).
- **Rules and journeys:** `mockups/SalesUxGuide.html`, `SalesNavMap.html`, `FlowS1–S6.html`. Each flow's *Step by step* table is the acceptance criteria.
- **Seed data:** `SALES_SEED_DATA.md`. It has the exact demo data and a list of mockup conflicts with the choice made. The choices in that list win over the mockups.
- **Requirements:** SRS §6.3 Sales and §8.4 Credit control, for detail.

## Layout additions

```
backend/src/sales/
├─ sales.module.ts, sales.permissions.ts
├─ shared/        statuses, totals.rules.ts (discount, tax inclusive/exclusive, 5-sen rounding),
│                 credit.rules.ts (exposure + policy decision), price.rules.ts, linked-docs (+ .spec.ts)
└─ enquiries/ quotations/ orders/ deliveries/ invoices/ proformas/ cash-sales/ debit-notes/
   returns/ cancel-orders/ approvals/ dashboard/ reports/ settings/ lookups/
   buy-to-order/ (listens to Purchase events: PO number, received and cancelled quantities)
   each: <name>.controller.ts, <name>.query.ts (reads), <name>.service.ts (commands), dto/, <name>.rules.ts (+ .spec.ts)
frontend/src/modules/sales/   router.ts, menu.ts, types.ts, routes.ts, api/, views/ (one view per S-code)
```

- Shared ERP components in `components/erp/` are reused as they are. They must stay module-neutral, so a fix to one is a fix for both modules.
- `data-module="sales"` gives the purple theme from `DESIGN_TOKENS.md`. No hex values in views.

## Module boundaries (Sales)

1. `sales/` never imports from `purchase/`, and `purchase/` never imports from `sales/`. The same applies to `modules/sales` and `modules/purchase` in the frontend. Shared code goes to `platform/`, `master-data/` or `components/erp/` (no business rules there).
2. Sales reads and writes only `sal_` tables. Customers, items, price lists, tax codes, users and branches come through `MasterDataPort`. New port methods: customers, price lists and prices, sellable items.
3. **Stock** comes from `inv_stock_snapshot`, read only.
4. **Payments** come from a new read-only stub `fin_receipt_stub` until Finance exists. Sales never changes a balance by hand.
5. Cross-module effects go out only as outbox events (`EVENTS.md` → *Sales publishes*). A module that is not connected never blocks the user: save the event and show the amber banner.
6. Purchase's demand list reads `pur_sales_demand`, its own copy of open sales-order lines, kept from `sales.order.released`, `sales.shipment.requested` and `sales.order.balance_cancelled` (decided at the end of Phase 2, `SALES_SEED_DATA.md` conflict 16). Sales never writes `pur_` tables, and Purchase never writes `sal_` tables.

## Master data and platform additions (step S1)

- **New `mdm_` seed tables:**
  - `mdm_customer`: code, name, TIN, addresses, contact, email, phone, category, area, branch, default agent, credit term days, credit limit, overdue limit, optional credit-scope override, price list, status ACTIVE / BLOCKED / PROSPECT.
  - `mdm_price_list` and `mdm_price_list_item`.
  - New items and users, as listed in `SALES_SEED_DATA.md`.
- **`mdm_item`:** use the existing `isSellable` / `salesTaxCode`, and add `barcode`.
- **`NumberingService`** gets optional format tokens (`{YYMM}`, `{YYYY}`, `{BR}`, `{####}`) and a monthly restart, for EQ-2609-0011. Existing Purchase sequences keep working unchanged. Add a test that proves PO numbering is untouched.
- **`sys_number_sequence`** rows for Sales use `module = 'sales'`. Purchase Document Types (P25) already filters on module, so Sales rows do not show there.
- **Approvals:** reuse the platform approval requests (`sys_approval_request`). Kinds: DISCOUNT (quotation), CREDIT (order, delivery, invoice), PRICE (invoice).

## Roles and permissions

Roles and what they do:

| Role | Does | Approves |
|---|---|---|
| SALES_AGENT | Enquiry, quotation, sales order, cancel order (draft only), sales return (draft) | — |
| SALES_BILLING | Invoice, proforma, debit note, printing and email | — |
| SALES_STORE | Delivery orders and confirming them, receiving returned goods | — |
| COUNTER_STAFF | Cash sales | — |
| SALES_MANAGER | Releases cancel orders, sees margin, reports | Discount over 15%, credit on orders and deliveries, price below list on invoices |
| FINANCE_MANAGER | — | Invoices for customers over their credit or overdue limit |
| ADMIN | Everything, including Operation Policies | — |

Permission names, as decorators on every action:
- `sales.view`
- `sales.enquiry.edit`
- `sales.quotation.edit`, `sales.quotation.release`
- `sales.order.edit`, `sales.order.release`
- `sales.delivery.edit`, `sales.delivery.confirm`
- `sales.invoice.edit`, `sales.invoice.release`
- `sales.proforma.edit`
- `sales.cash_sale.edit`
- `sales.debit_note.edit`
- `sales.return.edit`, `sales.return.receive`
- `sales.cancel_order.edit`, `sales.cancel_order.release`
- `sales.margin.view`
- `sales.settings.manage`

Approving is not a permission. The approval request names the role or the person.

**Dev user switcher:** add Aina Rahman, Lim Wei Jie, Faizal Omar, Nor Azlina and Siti Counter 1. Rosnah Ismail also acts as Finance Manager.

## Sales business rules (enforce on the server, test in `*.rules.spec.ts`)

1. **A step can never be bigger than the one before.** Deliver ≤ order balance (ordered − delivered − cancelled). Invoice ≤ delivered − invoiced (the policy "Invoice from delivered quantity only" is on). Return ≤ invoiced − returned, per invoice line. Messages name the limit, e.g. `Deliver now cannot be more than the balance (100).`
2. **Credit check**, run on save and again on release, for quotation, sales order, delivery order, invoice and cash sale:
   - **Exposure** = owed (unpaid balances of released invoices, including migrated ones, after credits, deposits and payments) + open value of the customer's other released or pending orders (not drafts, not yet invoiced) + this document.
   - **Overdue** = balances past their due date.
   - Each check is compared with the customer's credit limit and overdue limit. Scope is group-wide or per branch (Credit Control, S29); the customer's own setting in Master Data overrides it.
   - **On a breach**, the policy for that document and breach type decides:
     - *Allow, show warning:* save, with a warning.
     - *Require approval:* save as draft; release is blocked until approved; the agent gives a reason and requests approval; cancelling or deleting the document withdraws the request.
     - *Block:* 409 with the numbers.
   - The check result is stored on the document as a snapshot ("Credit at save").
   - The requester can never approve their own request.
   - System-made documents skip the check when the policy says so, and every skip is logged.
3. **Discount over 15% on any quotation line** needs Sales Manager approval before release. Estimated margin is shown only with `sales.margin.view` and when the policy switch is on.
4. **Strict price list:** an invoice line priced below the customer's price list needs Sales Manager approval before release.
5. **Allowed customers and items:**
   - Only ACTIVE customers on quotations and later documents. Enquiries may use a prospect, and a prospect must be added in Master Data before quoting.
   - Only sellable items that are not excluded for that branch on that date (S32).
   - Short stock only warns, never blocks.
6. **Quotations:**
   - Valid-until is required to release.
   - Released is locked.
   - *Revise* creates revision n+1 under the same number. Only released or expired quotations can be revised, and the old revision is kept read-only.
   - *Lost* needs a reason and closes the enquiry as Lost.
   - The list warns 3 days before a released (not yet ordered) quotation expires.
   - *Transfer to sales order* copies all lines or only some, at the quoted prices and tax.
7. **Released documents are locked and never deleted.** Corrections go through a revision (quotation, sales order), a cancel order (undelivered balance), a sales return (delivered and invoiced goods) or a debit note (missed charge). Drafts may be deleted.
8. **Cancel order:** only the undelivered balance can be cancelled. Agents draft; only `sales.cancel_order.release` releases. Releasing closes the order as DONE with `balanceCancelled`. Nothing is posted. A buy-to-order line linked to a PO shows a warning and publishes `sales.order.balance_cancelled` so Purchase can act.
9. **Proforma:**
   - It is a payment request only: no posting, no LHDN, no change to the order.
   - Request is a deposit % or pay before release.
   - While a released proforma for an order is unpaid, delivery of that order cannot be confirmed.
   - A paid deposit is used once, on the order's next invoice: balance due = total − deposit − credits − payments.
10. **Cash sale:**
    - Customer defaults to C-CASH, tax mode Inclusive, no credit check.
    - Balance must be 0 to release (received ≥ to pay; change is calculated).
    - An own e-Invoice needs the buyer's name and TIN; otherwise the sale goes into the monthly consolidated e-Invoice, due the 7th of next month.
    - One document records the sale, the payment and the stock out.
11. **Debit note:** always points to exactly one released invoice, never moves stock, and raises that invoice's balance.
12. **Sales return:** from one released invoice. A return location is required (Damaged goods or stock). Releasing lowers the invoice balance, saves a stock-in event and queues a credit note for Finance and LHDN.
13. **Numbers:** from `NumberingService` on first save and never reused. Enquiries use EQ-{YYMM}-{####} and restart monthly. Quotation revisions keep their number.
14. **Money:**
    - line gross = round(qty × price, 2)
    - line discount = round(gross × disc% / 100, 2)
    - net = gross − discount
    - tax (exclusive) = round(net × rate, 2)
    - tax (inclusive) = round(net × rate / (1 + rate), 2)
    - header totals = sums of the lines
    - rounding adjustment to 5 sen when the policy is on, kept as its own amount

## Statuses

| Document | Statuses |
|---|---|
| Enquiry | NEW, FORWARDED, QUOTED, LOST |
| Quotation | DRAFT, PENDING_APPROVAL, RELEASED, ORDERED, LOST, SUPERSEDED (old revision). *Expired* is shown when RELEASED and past valid-until, not stored |
| Sales order | DRAFT, PENDING_APPROVAL, RELEASED, PARTIAL, DONE (flag `balanceCancelled` → chip "Balance cancelled"), CANCELLED |
| Delivery order | DRAFT, CONFIRMED (chip "Delivered") |
| Invoice | DRAFT, PENDING_APPROVAL, RELEASED. *Unpaid, Overdue* and *Paid* are worked out from balance and due date. A rejection sends it back to DRAFT with the comment |
| Proforma | DRAFT, SENT, PAID, USED, CANCELLED |
| Cash sale | DRAFT, RELEASED |
| Debit note | DRAFT, RELEASED |
| Sales return | DRAFT, RELEASED |
| Cancel order | DRAFT, RELEASED |

Like the quotation and invoice, a rejected sales order goes back to DRAFT with the approver's comment. There is no REJECTED status in Sales.

## Events Sales publishes

| Event | When |
|---|---|
| `sales.order.released` | SO released. Buy-to-order lines tell Purchase to draft a PO |
| `sales.order.balance_cancelled` | Cancel order released |
| `sales.shipment.requested` | DO confirmed (Inventory) |
| `sales.invoice.released` | Finance receivable, LHDN e-Invoice |
| `sales.return.released` | Inventory stock in, Finance and LHDN credit note |
| `sales.debit_note.released` | Finance, LHDN |
| `sales.cash_sale.released` | Finance receipt, Inventory stock out, LHDN (own or consolidated) |

Each event is written in the same transaction as the document change, together with `sys_activity` and the `sys_doc_link` edges.

## Events Sales listens to

| Event | What Sales does |
|---|---|
| `purchase.buy_to_order.handled` | Puts the PO number, or the reason there is none, on each buy-to-order line |
| `purchase.goods.received` | Adds the received quantity to the order lines on that PO; received goods count as ready on the delivery waiting list |
| `purchase.order.balance_cancelled` | Adds the cancelled quantity to those lines, counting only what the order is short |

Purchase and Sales react to each other as **module listeners** (`OutboxConsumers.listen`). A listener never changes an event's status, so the "not connected" banners stay true for Inventory and Finance. See `EVENTS.md` → *Two kinds of consumer*.

## Frontend notes (Sales)

- **Sidebar:**
  - *Sales Transaction:* Enquiry, Draft Quotation (opens the quotation list on the Draft tab), Quotation, Sales Order, Delivery Order, Cancel Order.
  - *Billing:* Proforma Invoice, Invoice, Cash Sales, Debit Note, Sales Return.
  - *Operation Policies:* Credit Control, Document Types, Enquiry Types, Excluded Items, Email Templates.
  - *Reports.*
- **Routes** carry `meta: { code: 'S11', title: 'Sales order', menuGroup: 'transaction' }` like Purchase.
- **S04 Add item** is one dialog reused by quotation, sales order, invoice and cash sale. It shows the price list price, last price sold to this customer, stock at the branch, and greys out excluded and not-for-sale items with the reason.
- **S20 Print preview** is an HTML A4 page. The browser's own print is fine; no PDF library.
- **S05 Reports:** build *Sales by customer*. The other six report tabs show a placeholder until asked.
- **Banners:**
  - Inventory, Finance and LHDN not connected: amber, as in the mockups.
  - LHDN shows "e-Invoice: pending". Nothing is ever submitted in this phase.

## Build order for phase 2 (stop after each step for the user to review)

**S0 · Planning.** This section and `SALES_SEED_DATA.md`. The user confirms the mockup conflict choices.

**S1 · Master data, schema and seed.**
- Add the `mdm_customer` and price list tables, items, users and roles.
- Add `fin_receipt_stub`.
- Extend `NumberingService` (formats, monthly restart).
- Add all `sal_` tables.
- Seed `SALES_SEED_DATA.md`.
- Run `prisma migrate dev` and `db seed`, and print row counts plus checks such as balance due 84,640.00, overdue 36,900.00 and September ordered 274,098.00.
- Purchase seed checks must still pass.

**S2 · Sales shell.**
- Purple theme and `ModuleLayout` with the Sales menu.
- All Sales routes, with placeholders for screens not built yet.
- S01 Sales home with its dashboard API.
- The launcher Sales tile opens Sales.
- Sales users in the dev switcher.
- *Review with the user.*

**S3 · Sales orders, credit check and approvals.** S10 list, S11 form, S12 credit check failed, S02 approvals inbox, S04 add item. This is the core loop.

**S4 · Enquiry and quotation.** S06, S07, S08, S09: discount approval, revise, lost, and transfer to sales order.

**S5 · Delivery.** S15, S16: waiting list, confirm delivery, and the deposit hold.

**S6 · Invoices.** S17, S18 (create from delivered), S19 (price and credit approval), S20 print preview.

**S7 · Proforma.** S21, S22, and using the deposit on the invoice.

**S8 · Fixes and counter.**
- S13, S14 cancel order
- S27, S28 sales return
- S25, S26 debit note
- S23, S24 cash sale

**S9 · Flow, settings and report.** S03 document flow, S29 credit control, S30 document types, S31 enquiry types, S32 excluded items, S33 email templates, S05 sales by customer.

**S10 · Link with Purchase.**
- Purchase listens to `sales.order.released`: buy-to-order lines auto-draft a PO when the Purchase setting "Auto-draft a PO for buy-to-order sales lines" is on, and Purchase answers with `purchase.buy_to_order.handled`.
- Sales listens to `purchase.buy_to_order.handled`, `purchase.goods.received` and `purchase.order.balance_cancelled` to show buy-to-order line status.
- Decided at the end of Phase 2: Purchase demand comes from a Purchase-owned table fed by Sales events (`pur_sales_demand`, `SALES_SEED_DATA.md` conflict 16). P04's seed estimate is RM 15,440.00, because SO-0008 is not released. `sal_demand_stub` is dropped.

**Definition of done for every Sales step:** the same as Purchase. The screen matches its mockup (or the choice in the conflicts list); the seed shows the mockup numbers; rules have unit tests; backend `npm run build` and frontend `npm run type-check` and lint pass; Purchase tests still pass; a short "what to click" note; a commit with a clear message.


---

# Phase 3 · Core module (Master Data)

**Status:** C0 to C8 are done; Phase 3 is waiting for the user's final review. C0: the Core mockups (C01–C14), `CORE_SEED_DATA.md` and the Core section in `SCREENS.md`, checked against the SRS and SDD. C1: Core module, permissions and role, numbering, audit and event helpers, the data changes below, the record-usage check, the Core shell and the C01 home. C2: items and units (C02, C03, C11). C3: customers (C04, C05) with credit fields under their own permission and the prospect link with Sales. C4: suppliers (C06, C07) with contract prices under their own permission; buyers edit suppliers. C5: price lists (C08, C09) with dated prices; Sales reads them through the port with the same answers. C6: tax codes with types and rate history (C10), reference lists (C12), warehouses with read-only locations (C13). C7: import from CSV (C14) for customers, suppliers, items and price-list prices, through the screens' own services. C8: the Core handbook's journeys A–I as end-to-end tests (`test/core-journeys.e2e-spec.ts`), the Core handbook, and a final review of the module boundaries.

Everything above still applies to Core: stack, database and API conventions, no login, the working agreement and the definition of done. This section adds what is different. **Purchase and Sales are finished; Core must not change their behaviour.** If a Core step seems to need a Purchase or Sales change, ask first.

## What Core is

- **Core owns the shared reference data** that every module reads (`MASTER_DATA_CONTRACT.md`): items, units and conversions, customers, suppliers, price lists, tax codes, warehouses and the small lists behind them.
- **Today the `mdm_` tables are filled only by the seed.** Phase 3 makes Core a working module with screens, so an administrator can create and maintain that data, with an audit trail and events.
- **Purchase and Sales behave the same.** They keep reading through `MasterDataPort`, whose methods and answers stay the same, so their tests and seed checks keep passing. The only code they get is a read-only provider for the record-usage check (below), which the user approved in C0.
- The launcher's **Core** tile ("Items, customers, suppliers, tax and price lists") opens it. The legacy system kept this in its *Common* module (SRS Appendix B.2); SRS §6.2 and SDD §8.3 have the detail.

**Not in Phase 3** (each comes with the module or phase that needs it):
- **Configuration** (users, roles, branches, company settings) and login. They stay seeded until their own phase.
- Bills of material (with MES), tax profiles and exemptions (with the *exemption permitted* flag on tax codes), merging duplicate parties, bank accounts, derived and foreign-currency price lists, item scope per branch (Sales' *Excluded items* covers selling).
- Quantity breaks on prices (SRS FR-MST-030), together with the Sales change that applies them.
- Brands, tariff codes, payment plans and departments (FR-MST-001, FR-MST-058).
- Item fields for stock and costing: stock-keeping method, costing method, minimum level, weight and size, putaway flag (FR-MST-003 to 007), with Inventory/WMS. Extra descriptions and an image (FR-MST-001).
- Party fields: company or individual, salutation, notes, several addresses and contacts, a second agent, payment and delivery terms, currency and control account (FR-MST-040, 041, 044); shared or branch-private accounts (FR-MST-047). *Tax registration number* and *tax type* from FR-MST-042 (`CORE_SEED_DATA.md` choice 8).
- Checking a TIN online with LHDN (FR-MST-043, FR-EIV-003), with the LHDN phase.
- Item codes prefixed by group (FR-MST-010) and party codes numbered per letter (BR-NUM-004).
- Inventory, WMS and Finance, as before.

## Must-read for Core

- `docs/integration/MASTER_DATA_CONTRACT.md`: entities, the three rules (same code, same meaning, one owner), field tables.
- SRS §6.2 *Master Data* and §9.2 *Master data entities*; SDD §8.3 *Master data*.
- **Mockups:** `docs/design/mockups/Core*.html` and `docs/design/screenshots/C*.png`, made in C0 in the app's current layout. Once approved they are the design, like the Purchase and Sales mockups.
- **Seed data:** `docs/design/CORE_SEED_DATA.md`: the master data as Core shows it, the rules the SRS and SDD decide (with references), and the choices made. Its choices list wins over the mockups.

## Decisions (confirmed in C0)

Checked against the SRS and SDD after the first review; where they decide, they are followed. The user approved the rest.

| # | Decision | What it means | Source |
|---|---|---|---|
| 1 | Scope | Items with units and conversions, customers, suppliers with their contract prices, price lists, tax codes, reference lists (item groups, customer categories, areas, credit terms), warehouses (locations read only). CSV import last (C7): customers, suppliers, items and price-list prices | SRS §6.2, part of it; the rest is under *Not in Phase 3* |
| 2 | Who maintains | `MASTER_DATA_ADMIN` (Admin) changes everything. The Finance Manager also changes customer credit (credit limit, overdue limit, credit term, credit scope). Buyers and the Purchasing Manager also change suppliers, but only the Purchasing Manager and the Master Data Admin change contract prices, because a contract price lets an order skip the RFQ. Everyone else reads; sales agents never change master data | SRS §3.3; choices 7 and 11 |
| 3 | Approval for changes | None: approvals are for documents. Every change is logged with before and after values | SRS FR-SEC-050, FR-WFL-001, NFR-AUD-001, DR-003 |
| 4 | Codes | Customers and suppliers numbered by `NumberingService` (`C-####`, `S-####`, module `core`). Item, unit, warehouse, price-list and tax codes typed by the user. Unique per tenant. **A code never changes after it is saved** (other systems match on codes) | SRS FR-MST-048, DR-004; SDD §8.3; contract rule 1 |
| 5 | Delete and deactivate | A record can be deleted only while nothing uses it: no Purchase or Sales document of any status and no other Core record. After that it is blocked, discontinued or ended. An item, customer or supplier cannot be blocked or discontinued while an open document uses it | SRS DR-002, FR-MST-049; SDD §5.3.1, §7.3; choice 6 says what *open* means |
| 6 | Locations | Core edits warehouses. Locations are read only: bins and stock locations belong to Inventory, which here is the WMS. Until it is connected, the seeded locations stay as they are | SRS FR-INV-001; SDD §6.1; contract checklist |
| 7 | Prospect → customer | Core's *New customer* can take an enquiry number. `mdm.customer.created` carries it, and Sales links that enquiry to the new customer (FlowS1 step 2: "the enquiry keeps its link") | FlowS1; not in the SRS |
| 8 | Theme | Core is indigo, like its launcher tile (`--tile-core`). C0 adds its module tokens to `DESIGN_TOKENS.md` | Design |
| 9 | e-Invoice identity | Items carry an e-Invoice classification code. Customers and suppliers carry TIN, ID type (`BRN`, `NRIC`, `PASSPORT`, `ARMY`; default `BRN`), ID number, sales tax no, service tax no and e-Invoice email. Missing values are flagged on C01 and on the form, never blocking. Nothing is checked online in this phase | SRS FR-MST-008, FR-MST-042, FR-EIV-002, Appendix E; SDD §12.2; choice 8 |
| 10 | Import | *Check* reads the file and saves nothing. *Load* saves the rows that passed, each on its own. Rows with a problem come back as a CSV to fix and upload again. Imports go through the same services and rules as the screens | SRS BR-STA-005, DR-005, INT-013, BR-VAL-020; SDD §9.6, §12.4 |

## Layout additions

```
backend/src/core/
├─ core.module.ts, core.permissions.ts
├─ shared/        audit diff (before/after), code rules, status rules (+ .spec.ts)
└─ items/ uoms/ customers/ suppliers/ price-lists/ tax-codes/ reference/ warehouses/ imports/ dashboard/
   each: <name>.controller.ts, <name>.query.ts, <name>.service.ts, dto/, <name>.rules.ts (+ .spec.ts)
backend/src/platform/usage/   record-usage registry (no business rules)
backend/src/purchase/usage/, backend/src/sales/usage/   their read-only providers (+ .spec.ts)
frontend/src/modules/core/    router.ts, menu.ts, types.ts, api/, views/ (one view per C-code)
docs/design/mockups/Core*.html, docs/design/CORE_SEED_DATA.md (made in C0)
```

`backend/src/master-data/` stays the read side behind `MasterDataPort`. Its Prisma adapter keeps reading the same `mdm_` tables, which Core now writes.

## Module boundaries (Core)

1. Core is the **only** module that writes `mdm_` tables. Purchase and Sales keep reading only through `MasterDataPort`.
2. `core/` never imports `purchase/` or `sales/`, and the reverse; the frontend modules likewise.
3. Core never reads `pur_` or `sal_` tables. Where a record is used comes from the record-usage check; anything else comes as events.
4. A change in Core never rewrites an existing document: documents keep their snapshots (contract rule 3).
5. Every change, in one transaction: the record, `sys_activity` with before and after values, and an `mdm.*` event.

## Record-usage check

How Core knows whether a record is used (decision 5) without reading other modules' tables. The user approved it in C0.

- **Registry:** `platform/usage/` keeps a list of providers, the same way `OutboxConsumers` keeps listeners. Core asks it about one record: an item, customer, supplier, unit, tax code, price list or warehouse.
- **Providers:** Purchase and Sales each register one. It reads only its own module's tables and answers two things: how many of its documents use the record, and which of them are open (document type, number, status). Core imports neither module.
- **Open** (`CORE_SEED_DATA.md` choice 6): a draft, a document waiting for approval, or a released document with something left to deliver, receive, invoice or bill. Released invoices waiting for payment do not count.
- **No behaviour change:** a provider only reads. Purchase and Sales tests and seed checks keep passing. Each provider has unit tests for its *open* rule. An e2e test checks the seeded answers: CH-DIN-01 on 19 documents with 7 open, C-0012 on 23 with 5 open, S-0047 on 6 with 3 open. A document counts once, whatever its revisions.
- **Lookup:** `GET /api/v1/core/usage/:kind/:code` (`item`, `customer`, `supplier`, `uom`, `tax-code`, `price-list`, `warehouse`) returns the count, the open documents and other references (Sales' excluded items). Core's pure rules in `core/usage/usage.rules.ts` turn it into the delete and block refusals.
- **Later:** WMS and MES get a provider too, answering through their API.

## Data changes (step C1)

What the contract and SRS need that the `mdm_` tables lack today:
- **On every `mdm_` table Core edits:** `version` (optimistic lock), `createdBy`, `updatedBy`.
- **Effective-dated tax** (SRS BR-TAX-006): a rate change adds a row with its own `validFrom`; a rate is never edited in place. `listTaxCodes` keeps answering the rate valid today.
- **Dated prices** (SRS BR-PRC-003/004): price-list prices carry `validFrom`, so a future price waits for its date and the price on any past date can be shown. `listPrices(onDate)` keeps its meaning.
- **Reference lists:** `mdm_item_group`, `mdm_customer_category`, `mdm_area`, `mdm_credit_term`, so these are picked from a list instead of typed (today they are free text).
- **Item:** e-Invoice classification code (SRS FR-MST-008).
- **Customer and supplier:** e-Invoice identity (SRS FR-MST-042): `idType` (default `BRN`), `idNumber`, `salesTaxNo`, `serviceTaxNo`, `einvoiceEmail`. The supplier's existing `regNo` and `sstNo` serve as its ID number and sales tax no; columns the port already reads keep their names.
- **Tax code:** `type`: `SALES_TAX`, `SERVICE_TAX` or `EXEMPT` (SRS FR-MST-055).
- **Kept as they are:** one address and one contact per party. Multiple addresses and contacts come later.

## Roles and permissions

- **New role:** `MASTER_DATA_ADMIN` (decision 2).
- **Permissions:**
  - `core.view`
  - `core.item.edit`, `core.customer.edit`, `core.customer.credit`, `core.supplier.edit`, `core.supplier.contract`
  - `core.price_list.edit`, `core.tax.edit`, `core.reference.edit`, `core.warehouse.edit`
  - `core.import`
- **Grants:**
  - `MASTER_DATA_ADMIN`: all of them.
  - `FINANCE_MANAGER`: view, `core.customer.credit`.
  - `PURCHASE_BUYER`: view, `core.supplier.edit`.
  - `PURCHASE_MANAGER`: view, `core.supplier.edit`, `core.supplier.contract`.
  - Every other Purchase and Sales role: view.
- C1's shell has a single `core.edit`. The rest of C1 splits it into the permissions above.

## Core business rules (enforce on the server, test in `*.rules.spec.ts`)

1. **Codes:** unique per tenant, never reused (not even a deleted record's code), never changed after saving.
2. **Statuses:**
   - Item `ACTIVE` / `BLOCKED` / `DISCONTINUED`.
   - Customer `ACTIVE` / `BLOCKED` / `PROSPECT`.
   - Supplier `ACTIVE` / `BLOCKED`.
   - Purchase and Sales already use only active records.
3. **Delete** (SRS DR-002, FR-MST-049):
   - Only while nothing uses the record: the record-usage check finds no document of any status, and no Core record points to it (an item's unit, a customer's price list …).
   - Otherwise 409, naming where it is used, e.g. `CH-DIN-01 is used on 19 documents, so it cannot be deleted. Discontinue it instead.`
   - A delete is logged with the record as it was, and publishes `mdm.<record>.deleted`.
   - Reference-list entries follow the same rule against Core records.
4. **Block and discontinue** (SDD §5.3.1): refused while an open document uses the item, customer or supplier. The 409 names the documents, e.g. `C-0012 is on 5 open documents (SO-0001, SO-0003, QT-0006 …). Finish or cancel them first.` *Activate* is always allowed when the required fields are filled.
5. **Required to activate:**
   - Item: name, group, type, base unit, purchase tax if purchasable, sales tax if sellable.
   - Customer: name, branch, price list, credit term.
   - Supplier: name, payment term, currency.
6. **Units:**
   - A conversion reads "1 from = factor to", and one side is the item's base unit. The factor is greater than 0.
   - A factor below 1 against the base unit is refused where it would give a fractional base quantity beyond the base unit's decimals (SRS FR-MST-017): with PCS (0 decimals), "1 BOX = 2.5 PCS" is refused.
   - The purchase and sales units are the base unit or a unit with a conversion.
   - An item's base unit cannot change once a document uses it.
   - A unit's decimals can go up any time, and down only while nothing uses the unit. A unit cannot be made inactive while an active item uses it.
   - Changing a factor never changes documents.
   - An item's barcode is unique.
7. **Tax** (SRS BR-TAX-006, FR-MST-055): every code has a type; rates are effective-dated, with no overlapping periods for the same code; documents keep the rate they used.
8. **Price lists** (SRS BR-PRC-003, BR-PRC-004): one price per item, unit and date. A future price waits for its date, and the price on any past date can be shown. Quantity breaks come later (*Not in Phase 3*).
9. **Customer credit:**
   - Credit limit and overdue limit are 0 or more, or empty for no limit.
   - Changes need `core.customer.credit` and are logged with before and after values.
10. **Contract prices** need `core.supplier.contract`: a contract price lets an order skip the RFQ (Purchase rule 4).
11. **e-Invoice gaps** (decision 9): a missing classification code, TIN or ID number is flagged on C01 and on the form. It never blocks a save, and Purchase and Sales keep working.
12. **Import** (decision 10):
    - *Check* saves nothing.
    - *Load* saves each passing row in its own transaction, through the same service as the screen.
    - A known code updates that record; an empty code adds one with the next number.
    - Rows with a problem are returned as a CSV.
13. **Audit:** every save writes `sys_activity` with the changed fields, old and new values.

## Events Core publishes

| Event | When |
|---|---|
| `mdm.item.created` / `mdm.item.updated` | Item saved (including status changes) |
| `mdm.customer.created` / `mdm.customer.updated` | Customer saved. `created` may carry the enquiry number it came from (decision 7) |
| `mdm.supplier.created` / `mdm.supplier.updated` | Supplier saved, including its contract prices |
| `mdm.price_list.updated` | Price list or its prices saved |
| `mdm.tax_code.updated` | Tax rate added or changed |
| `mdm.uom.updated`, `mdm.warehouse.updated` | Unit or warehouse saved |
| `mdm.reference.updated` | Item group, customer category, area or credit term saved (module boundaries rule 5) |
| `mdm.<record>.deleted` | A record that nothing used was deleted (rule 3) |

Payloads carry the code and the full snapshot after the change, plus the list of changed fields. Purchase and Sales read through the port and need no cache, so these events are mainly for WMS, MES and Finance later. **Sales listens to `mdm.customer.created`** (listener `sales.prospect-link`) to link an enquiry's prospect (decision 7): the enquiry gets the new customer and can be quoted.

## Screens (C-codes, mockups made in C0)

| Code | Screen | Route |
|---|---|---|
| C01 | Core home: counts, recently changed, records needing attention (items without an e-Invoice classification code, parties without a TIN or ID number …) | `/core` |
| C02, C03 | Item list; item form (general, units and conversions, buying, selling, where it is used, activity) | `/core/items`, `/core/items/:id` |
| C04, C05 | Customer list (Active, Prospect, Blocked); customer form (general, address and contact, tax identity, credit, where it is used, activity) | `/core/customers`, `/core/customers/:id` |
| C06, C07 | Supplier list; supplier form (general, contact, tax identity, terms, contract prices, where it is used, activity) | `/core/suppliers`, `/core/suppliers/:id` |
| C08, C09 | Price lists; price list with its dated prices | `/core/price-lists`, `/core/price-lists/:id` |
| C10 | Tax codes with their type and rate history | `/core/tax-codes` |
| C11 | Units of measure and conversions | `/core/uoms` |
| C12 | Reference lists: item groups, customer categories, areas, credit terms | `/core/reference` |
| C13 | Warehouses; their locations read only | `/core/warehouses` |
| C14 | Import from CSV: check (saves nothing), then load the rows that pass; rows with a problem to download (idempotent on codes) | `/core/import` |

API under `/api/v1/core/...` with the usual list, detail, create, update and delete (only while unused), plus status actions (`block`, `activate`, `discontinue`). Details include where the record is used.

## Build order for phase 3 (stop after each step for the user to review)

**C0 · Planning and design.** This section; the decisions above; mockups for C01–C14 (`docs/design/mockups/Core*.html` + screenshots, same style as Purchase and Sales); `CORE_SEED_DATA.md` (the existing master-data seed plus anything the mockups show); the Core section in `SCREENS.md`; Core theme tokens. The user approves the mockups and decisions.

**C1 · Module, schema and shell.**
- Core module, permissions and role, with `core.edit` split into the permissions above.
- The data changes above, with migrations and their seed values (`CORE_SEED_DATA.md`).
- Audit diff helper; numbering for customers and suppliers.
- The record-usage check, with the Purchase and Sales providers.
- Core shell (theme, layout, menu, all routes with placeholders); C01 home with *Needs attention*; the launcher tile opens Core.
- Purchase and Sales seed checks and tests still pass.

**C2 · Items and units.** C02, C03 (with where it is used, delete and discontinue), C11.

**C3 · Customers.** C04, C05: credit fields with their own permission, the e-Invoice identity fields, where it is used, and the prospect link with Sales (`mdm.customer.created`).

**C4 · Suppliers.** C06, C07 with contract prices (`core.supplier.contract`), the e-Invoice identity fields and where it is used. Buyers and the Purchasing Manager can edit suppliers.

**C5 · Price lists.** C08, C09 with dated prices; Sales still reads prices through the port with the same answers.

**C6 · Tax, reference lists, warehouses.** C10 with tax types, C12, C13 with read-only locations.

**C7 · Import.** C14: customers, suppliers, items and price-list prices from CSV. Check first (saves nothing), then load the rows that pass, each on its own; the rows with a problem download as a CSV.

**C8 · Core journeys.** End-to-end tests for the Core journeys, the Core handbook, and a final review.

**Definition of done for every Core step:** as for Sales, plus: backend `npm run test:e2e` passes; Purchase and Sales tests and seed checks still pass unchanged; the screen matches its approved Core mockup.

---

# Phase 4 · Configuration

**Status:** A0 to A6 are done; A6 is waiting for the user's review. A0: this section, the Configuration mockups (A01–A14), `CONFIG_SEED_DATA.md` and the Configuration section in `SCREENS.md`, checked against the SRS and SDD. A1: the Configuration module; the new `sys_` tables, with users and branches moved out of `mdm_`; each module's permission catalogue, and roles as data seeded from the code grants (the permission registry reads them from the database); correlation ids on activity; the Configuration shell and the A01 home. A2: the company (A04) and branches (A05) with their rules; the record-usage check also answers for a branch (Purchase and Sales providers, read only); the before-and-after audit helper moved to the platform. A3: users (A06, A07) with roles between dates, branches and the default branch, deactivate (ends sessions), the last-Administrator rule, and role changes and deactivations in the security log. A4: roles (A08, A09) with the permission editor by module, the two data-scope switches (applied in A7), Reset to starter, custom roles deleted only while nobody holds them, and Who can do what (A10: a person, or two roles compared); a role change applies on the next request. A5: sign-in with AUTH_MODE=jwt (argon2id passwords, 15-minute access tokens, rotating single-use refresh tokens in an httpOnly cookie with reuse detection, lockout per account and network address, 30-minute idle time-out, branch switch, sign-out), the JWT guard next to the dev guard with the session checked on every request, the A02 page, the branch switch and user menu in every top bar, and the every-endpoint test (401 without a token, 403 without the permission). A6: two-factor (A03) with QR set-up and 8 recovery codes, required by role; forgot password and single-use reset and set-password links (written to the email log; new users get a set-password link); My account (A11: change password, devices, two-factor on and off, new recovery codes); sign-in settings (A14) applied on the next request; the user page's sign-in actions (send link, revoke sessions, unlock, reset two-factor); an optional demo-only fixed two-factor code for ADM (`DEMO_ADMIN_2FA_BYPASS_CODE`, logged on each use). Next: A7.

Everything above still applies: stack, database and API conventions, the working agreement and the definition of done. This section adds what is different, and it **replaces "No login yet" and the "login/JWT" item of "Do not build yet"** from step A5 on. **Purchase, Sales and Core keep their behaviour**, with two agreed exceptions: sign-in (A5) and data scopes (A7). If any other step seems to need a change there, ask first.

## What Configuration is

- The SRS module **Platform and Administration** (§6.1), opened from the launcher's existing **Configuration** tile ("Users · settings").
- It owns **who works here and what they may do**: the company and its branches, users, roles and permissions, sign-in, the security log and the audit trail.
- Users and branches are seeded today and read by every module through `MasterDataPort`. Roles are granted in code by each module. Phase 4 turns all of it into data maintained on screens, and adds real sign-in.

**Not in Phase 4** (each comes with the module or phase that needs it):
- Signing in through an outside identity provider (FR-SEC-067), accounts for integrations (FR-SEC-016, with WMS and LHDN), sign-in for the client portal.
- Approval chains as data, delegation and escalation (FR-SEC-050 to 055); Purchase and Sales keep their approval rules.
- Module settings in one generated screen (FR-PLT-006, 007), feature switches (FR-PLT-010), custom fields, maintenance mode, currencies and rates (with Finance).
- Branch statutory numbers for payroll (employer, EPF, SOCSO), with payroll.
- Masking sensitive personal fields (FR-SEC-042) and payroll data rules (FR-SEC-040, 041), with payroll.

## Must-read for Configuration

- SRS §5 *User Roles, Permissions and Access Control*, §6.1 *Platform and Administration*, §13.4 *Security*, §13.5 *Auditability*.
- SDD §10 *Authentication and Authorisation*, §8.2 *Platform and identity*, §7.5 *Tenancy*, ADR-05, ADR-19.
- **Mockups:** `docs/design/mockups/Cfg*.html` and `docs/design/screenshots/A*.png`, made in A0 in the app's current layout.
- **Seed data:** `docs/design/CONFIG_SEED_DATA.md`: the company, branches, users, starter roles, permission catalogue, sign-in settings, data scopes, the rules the SRS and SDD decide, and the choices made. Its choices list wins over the mockups.

## Decisions (confirmed by the user on 14 Oct 2026)

| # | Decision | What it means | Source |
|---|---|---|---|
| 1 | Scope | Company and branches, users, roles and permissions, sign-in with two-factor, my account and sessions, sign-in settings, security log, audit trail, data scopes | SRS §5, §6.1; user |
| 2 | Company | One company, CLB Groups Sdn Bhd, with HQ and Penang as its branches. A company is separate from its branches | SDD ADR-19; user |
| 3 | Packages | `argon2`, `@nestjs/jwt`, `cookie-parser`, `otplib` are approved | User |
| 4 | Two-factor | Built now (TOTP), required for Administrator, Master Data Admin, Finance Director and Finance Manager, in sign-in mode only | SRS FR-SEC-061; user |
| 5 | Data scopes | Built in this phase (A7): branch scope on documents and customers, sales-agent scope, on every route | SRS FR-SEC-020 to 033; user |
| 6 | Dev mode stays | `AUTH_MODE=dev` keeps the user switcher and `x-dev-user`, so the tests and the three handbooks keep working; `AUTH_MODE=jwt` turns on sign-in | Working agreement |
| 7 | Roles as data | Starter roles are today's code grants, unchanged; Administrator holds everything and cannot be changed; new starter role Auditor | SRS FR-SEC-001, 003, 014, 015 |
| 8 | Ownership | Users and branches move to Configuration's `sys_` tables; `MasterDataPort` keeps giving the same answers | SDD 8.2; choice 3 |

## Layout additions

```
backend/src/configuration/
├─ configuration.module.ts, configuration.permissions.ts
├─ shared/        password policy, lockout, scope rules (+ .spec.ts)
└─ organisation/ users/ roles/ auth/ account/ settings/ security-log/ audit/ dashboard/
   each: <name>.controller.ts, <name>.query.ts, <name>.service.ts, dto/, <name>.rules.ts (+ .spec.ts)
backend/src/platform/context/   the permission registry reads roles from the database; a JWT guard next to the dev guard
backend/src/platform/scope/     data-scope registry: modules register their scope providers (A7)
frontend/src/modules/configuration/   router.ts, menu.ts, types.ts, api/, views/ (one view per A-code)
frontend/src/modules/auth/            sign-in, two-factor, set and reset password pages (outside the module layout)
```

## Module boundaries (Configuration)

1. Configuration is the only writer of the identity and organisation tables (`sys_legal_entity`, `sys_branch`, `sys_user`, `sys_role` …). Other modules read users and branches through `MasterDataPort` and permissions through `@RequirePermission()`.
2. `configuration/` never imports `purchase/`, `sales/` or `core/`, and the reverse. Each module declares its own permission catalogue and starter grants; the platform aggregates them (FR-SEC-010).
3. Data scopes are applied by the platform: modules register a scope provider for their own tables (A7); Configuration owns only the user's branches and the role switches.
4. Every change, in one transaction: the record, `sys_activity` with before and after values, and a `config.*` event. Sign-in events go to `sys_security_event`.

## Data changes (step A1)

- **New tables:** `sys_legal_entity`, `sys_branch` (tree, document prefix, MyInvois branch name), `sys_user` (with password hash, two-factor secret and recovery codes, lockout counters), `sys_role` (with the agent-scope switches), `sys_role_permission`, `sys_user_role` (with optional valid-from and valid-until), `sys_user_branch` (with the default branch), `sys_session` (refresh-token family, device, last activity), `sys_login_attempt`, `sys_security_event`, `sys_setting` (sign-in settings), `sys_auth_token` (single-use reset and set-password links).
- **Moved:** `mdm_user` and `mdm_branch` into `sys_user`, `sys_user_role`, `sys_user_branch` and `sys_branch`. `MasterDataPort.listUsers`, `findUser` and `listBranches` keep their shapes.
- **Changed:** `sys_activity` gets a `correlationId`, set by the platform from the request (FR-PLT-016). `mdm_customer` gets `visibleToAllBranches` (A7, FR-SEC-033).
- **Permission registry:** reads role grants from the database (cached, cleared on any role change), so a role change applies on the next request. `ADMIN` keeps holding every permission.

## Roles and permissions

- **Permissions:** `config.view`, `config.organisation.edit`, `config.user.edit`, `config.role.edit`, `config.settings.manage`, `config.security.view`, `config.audit.view`.
- **Grants:** Administrator all of them. Auditor `config.view`, `config.security.view`, `config.audit.view`, plus `purchase.view`, `sales.view`, `core.view`. Every signed-in user may open *My account*.
- **Catalogue:** each module exports its permission keys with an object and action label (Purchase 17, Sales 19, Core 11, Configuration 7). Adding labels is declarative; no permission check changes.

## Sign-in (A5, A6)

| Element | Design | Source |
|---|---|---|
| Who | Email or user code, and password | FR-SEC-060; choice 11 |
| Password | argon2id; at least 10 characters; common passwords refused; no forced rotation | NFR-SEC-003; SDD 10.2 |
| Lockout | 5 wrong passwords lock for 15 minutes, counted per account and per network address; every attempt recorded | FR-SEC-062; SDD 10.2 |
| Tokens | Access token (JWT) for 15 minutes with user, tenant, session and active branch. Refresh token opaque, stored hashed, in an httpOnly cookie, 30 days, single use with rotation; reuse ends the whole session and logs a security event | NFR-SEC-008; SDD 10.2 |
| Idle | A session ends after 30 minutes without activity | FR-SEC-065 |
| Branch switch | Re-issues the access token with the new active branch; the branch cannot be set by a header in sign-in mode | FR-SEC-021; SDD 10.2 |
| Two-factor | TOTP with 8 recovery codes; required by role (setting); the Administrator can reset it | FR-SEC-061; choices 9, 13 |
| Sessions | Each user lists and revokes their own; the Administrator revokes anyone's | FR-SEC-065 |
| Reset | Single-use link valid 60 minutes, written to `sys_email_log`; new users get a set-password link, never a password | FR-SEC-063, 064; choice 10 |
| Coverage | Every endpoint needs a signed-in user except sign-in, reset and health. A test calls every route without a token (401) and without the permission (403) | FR-SEC-008; SDD 10.4 |

## Data scopes (A7)

- **Branch scope:** documents of Purchase and Sales by their branch, and customers by their branch unless *visible to all branches*. A user sees their own branches; the active branch stamps new documents. Applied by registered scope providers inside each module's queries, on lists, records, look-ups, reports, exports and dashboards.
- **Sales-agent scope:** for a user holding an agent-scoped role (seed: Sales agent), only customers whose default agent is the user, and only the sales documents of those customers. The two switches on the role control customers and documents separately (FR-SEC-031).
- **Not scoped:** suppliers, items, price lists, tax codes, warehouses (shared master data); event listeners and the seed (the *system*, logged).
- **Out of scope answers 404**, never 403 (SDD 10.3.1).
- **Tests:** for each scoped list and record endpoint, a Penang-only user cannot reach an HQ record and an agent cannot reach another agent's customer, by any route (SDD 10.4). The Purchase, Sales and Core journeys are re-run, and steps that cross a scope move to the right person.

## Configuration business rules (enforce on the server, test in `*.rules.spec.ts`)

1. **Codes** of companies, branches, users and roles are unique, never reused and never change.
2. **Administrator:** holds every permission; cannot be edited or deleted; at least one active user always holds it.
3. **Users:** an active user has at least one role and one branch, and a default branch among them. A user is deactivated, never deleted once they have signed in or appear in any document or activity. Deactivating ends their sessions.
4. **Role assignments:** valid-until on or after valid-from; an expired assignment stops giving permissions on that day; a role cannot be deleted while a user holds it.
5. **Permissions:** a role can only hold keys from the catalogue.
6. **Branches:** a branch cannot be its own ancestor; a branch is made inactive only when no active user has it as their only branch and no open document needs it; a company is made inactive only when none of its branches is active.
7. **Passwords and lockout** as in *Sign-in*; a reset or set-password link works once and expires.
8. **Two-factor:** a user whose role requires it cannot finish sign-in without it; set-up needs a correct code; resetting it is logged.
9. **Audit:** every change writes `sys_activity` with old and new values; the security log and the audit trail cannot be changed or deleted through the application.

## Events Configuration publishes

| Event | When |
|---|---|
| `config.user.created` / `config.user.updated` | User saved, including roles, branches and status |
| `config.role.updated` | Role or its permissions saved |
| `config.branch.updated`, `config.legal_entity.updated` | Branch or company saved |

Payloads carry the code, the snapshot after the change and the changed fields. No module listens yet; Finance, WMS and MES will. Sign-in, lockout, password, two-factor and session events go to `sys_security_event`, not the outbox.

## Screens (A-codes, mockups made in A0)

| Code | Screen | Route |
|---|---|---|
| A01 | Configuration home: counts and *Needs attention* | `/config` |
| A02, A03 | Sign in; two-factor set-up and code | `/sign-in`, `/sign-in/two-factor` |
| A04 | Company, with its branches | `/config/company` |
| A05 | Branches: tree and branch form | `/config/branches` |
| A06, A07 | User list; user form (person, roles with dates, branches, sign-in) | `/config/users`, `/config/users/:id` |
| A08, A09 | Role list; role form (data scope, permissions by module, users) | `/config/roles`, `/config/roles/:id` |
| A10 | Who can do what: a person's permissions; compare two roles | `/config/permissions` |
| A11 | My account: password, two-factor, sessions | `/account` |
| A12 | Security log | `/config/security-log` |
| A13 | Audit trail | `/config/audit` |
| A14 | Sign-in settings | `/config/sign-in-settings` |

## Build order for phase 4 (stop after each step for the user to review)

**A0 · Planning and design.** This section; the mockups A01–A14; `CONFIG_SEED_DATA.md`; the Configuration section in `SCREENS.md`; the slate tokens in `DESIGN_TOKENS.md`. The user approves.

**A1 · Module, schema and shell.** Configuration module and permissions; the new tables and the move of users and branches; the permission catalogue and roles as data, seeded from the code grants; correlation ids on activity; Configuration shell and A01 home; the launcher tile opens it. Purchase, Sales and Core tests, seed checks and journeys pass unchanged.

**A2 · Company and branches.** A04, A05.

**A3 · Users.** A06, A07: roles with dates, branches and default branch, deactivate.

**A4 · Roles and permissions.** A08, A09, A10: permission editor, reset to starter, data-scope switches, a person's permissions, compare two roles.

**A5 · Sign-in.** A02 and the sign-in flow: passwords, tokens, lockout, branch switch, sign-out; the top bar's branch switch and user menu; the JWT guard next to the dev guard; the every-endpoint 401/403 test.

**A6 · My account and two-factor.** A11, A03, A14: change password, sessions, reset and set-password links, two-factor with recovery codes.

**A7 · Security log, audit trail and data scopes.** A12, A13; the scope registry and providers in Purchase, Sales and Core; *visible to all branches* on customers; the scope tests; journeys re-run.

**A8 · Configuration journeys.** End-to-end tests for the Configuration journeys, the Configuration handbook, and a final review.

**Definition of done for every Configuration step:** as for Core, plus: the Purchase, Sales and Core journeys pass in dev mode (and, from A7, with the scopes on); from A5, the every-endpoint test passes.
