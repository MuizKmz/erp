# Zora Pro ERP — build guide for Claude Code

We are building a modular ERP. **Phase 1 = the module launcher and the Purchase module**, as a working app with a real API and database (no login yet). Sales comes after Purchase. Read this file fully before writing code, then read the docs it points to.

## Must-read docs

| File | Why |
|---|---|
| `docs/design/SCREENS.md` | Every screen: mockup file, route, API |
| `docs/design/mockups/*.html` + `docs/design/screenshots/*.png` | The approved design. Open the HTML or view the PNG before building a screen |
| `docs/design/mockups/PurUxGuide.html`, `FlowP1–P7.html` | Purchase rules and journeys. Each flow’s *Step by step* table is the acceptance criteria |
| `docs/design/SEED_DATA.md` | Exact demo data. After seeding, screens must show the same numbers as the mockups |
| `docs/design/DESIGN_TOKENS.md` | Colours, type, chips, buttons |
| `docs/integration/MASTER_DATA_CONTRACT.md` | What Purchase reads from Master Data and how |
| `docs/integration/EVENTS.md` | Events Purchase publishes and listens to |
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
│  ├─ prisma/seed.ts          seeds docs/design/SEED_DATA.md
│  └─ src/
│     ├─ platform/            shared building blocks, no business rules
│     │  ├─ prisma/           PrismaService
│     │  ├─ context/          current user, tenant, branch (dev header for now)
│     │  ├─ numbering/        NumberingService (locks the sequence row)
│     │  ├─ activity/         ActivityService → sys_activity
│     │  ├─ approvals/        generic approval requests
│     │  ├─ outbox/           OutboxWriter + dispatcher (cron)
│     │  ├─ attachments/      local file storage under backend/uploads
│     │  └─ http/             list query DTO, list response, error filter
│     ├─ master-data/         MasterDataPort (interface) + Prisma adapter, READ ONLY
│     └─ purchase/
│        ├─ purchase.module.ts
│        ├─ shared/           statuses, totals.rules.ts, approval-limit.rules.ts, match.rules.ts (+ .spec.ts)
│        └─ requests/ rfqs/ orders/ receipts/ cancel-orders/ invoices/
│           cash-purchases/ debit-notes/ returns/ approvals/ demand/ dashboard/ settings/
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
3. Purchase never writes `mdm_` tables and never queries them directly — only through `MasterDataPort`. Phase 1 adapter reads local seed tables; later it will call the real Master Data API, and nothing in `purchase/` may need to change.
4. Stock on hand comes from a read-only stub (`inv_stock_snapshot`) until Inventory/WMS is connected. Sales-order demand comes from `sal_demand_stub` until Sales exists.
5. When another module is not connected, never block the user: save the event and show the amber banner (“Inventory is not connected yet…”).

## Database conventions (MySQL + Prisma)

- One database `zora_erp`. Table prefixes via `@@map`: `sys_` platform, `mdm_` master data (seed only), `inv_` stubs, `pur_` purchase, later `sal_`. Prisma model names: `PurPurchaseOrder` → `@@map("pur_purchase_order")`.
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
- Do **not** build yet: login/JWT, Sales screens, real email sending, Inventory/Finance/WMS/MES integrations (only their events and stubs).
- Code, identifiers and comments in English. UI text exactly as in the mockups.
- Keep secrets out of git (`.env` in `.gitignore`).
