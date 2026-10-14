# Screen map

Every screen in the mockups, with the file to copy from, the Vue route to build, and the API it needs.
Open `docs/design/mockups/index.html` in a browser to click through the mockups like the real app.
Screenshots of the same screens are in `docs/design/screenshots/`.

**How to use a mockup when building a screen**

1. Open the mockup HTML and its screenshot.
2. Match the layout, wording, column order, buttons and status chips. Copy the labels exactly; they were written for users.
3. The sample numbers in the mockup (PO-0001, RM 4,400.00 …) come from the seed data in `CLAUDE.md` → *Seed data*. After seeding, the built screen should show the same values as the mockup.
4. Mockups are 1440 × 1000 px desktop screens. Build them responsive, but desktop first.

---

## Launcher

| Code | Screen | Mockup | Route | API |
|---|---|---|---|---|
| 00 | Choose a module | `Launcher.html` | `/` | `GET /api/v1/me/modules` (static list for now) |

Tiles: Core (Master Data, open since phase 3), Purchase (open), Sales (open), MES (later), WMS (existing, another team), Configuration (later). Core, Purchase and Sales are clickable.

---

## Purchase module (build first)

Sidebar groups: **Purchase Transaction**, **Supplier Billing**, **Operation Policies**. Theme: green (see `DESIGN_TOKENS.md`).

| Code | Screen | Mockup | Route | Main API |
|---|---|---|---|---|
| P01 | Purchase home (tiles + dashboard) | `PurHome.html` | `/purchase` | `GET /purchase/dashboard` |
| P02 | Approvals inbox | `PurApprovals.html` | `/purchase/approvals` | `GET /purchase/approvals?status=waiting`, `POST /purchase/approvals/:id/approve` · `/reject` |
| P03 | Document flow of a PO | `PurDocFlow.html` | `/purchase/orders/:id/flow` | `GET /purchase/orders/:id/flow` |
| P04 | Demand · what to buy | `PurDemand.html` | `/purchase/demand` | `GET /purchase/demand`, `POST /purchase/requests/from-demand` |
| P05 | Purchase request list | `PurRequestList.html` | `/purchase/requests` | `GET /purchase/requests` |
| P06 | Purchase request | `PurRequestForm.html` | `/purchase/requests/:id` (and `/new`) | `GET/POST/PATCH /purchase/requests/:id`, `POST …/submit` · `/reject` · `/to-rfq` · `/to-po` |
| P07 | RFQ list | `RfqList.html` | `/purchase/rfqs` | `GET /purchase/rfqs` |
| P08 | RFQ · compare replies and award | `RfqCompare.html` | `/purchase/rfqs/:id` | `GET /purchase/rfqs/:id`, `POST …/replies`, `POST …/award`, `POST …/close` |
| P09 | Purchase order list | `PoList.html` | `/purchase/orders` | `GET /purchase/orders` |
| P10 | Purchase order | `PoForm.html` | `/purchase/orders/:id` (and `/new`) | `GET/POST/PATCH /purchase/orders/:id`, `POST …/release` · `/email` |
| P11 | Send PO for approval (dialog) | `PoApproval.html` | dialog on P10 | `GET /purchase/orders/:id/approval-check`, `POST …/submit-for-approval` |
| P12 | Cancel order list | `PoCancelList.html` | `/purchase/cancel-orders` | `GET /purchase/cancel-orders` |
| P13 | Cancel PO balance | `PoCancel.html` | `/purchase/cancel-orders/:id` (and `/new?po=`) | `GET/POST/PATCH …`, `POST …/release` |
| P14 | Goods receipt list (+ waiting to receive) | `GrnList.html` | `/purchase/receipts` | `GET /purchase/receipts`, `GET /purchase/receipts/waiting` |
| P15 | Confirm goods received | `GrnConfirm.html` | `/purchase/receipts/:id` (and `/new?po=`) | `GET/POST/PATCH …`, `POST …/confirm` |
| P16 | Purchase invoice list | `PiList.html` | `/purchase/invoices` | `GET /purchase/invoices` |
| P17 | Purchase invoice · three-way match | `PiMatch.html` | `/purchase/invoices/:id` (and `/new`) | `GET/POST/PATCH …`, `GET …/match`, `POST …/decide` · `/approve` |
| P18 | Cash purchase list | `CashPurchaseList.html` | `/purchase/cash-purchases` | `GET /purchase/cash-purchases` |
| P19 | Cash purchase | `CashPurchase.html` | `/purchase/cash-purchases/:id` | `GET/POST/PATCH …`, `POST …/release`, attachments |
| P20 | Supplier debit note list | `PurDebitNoteList.html` | `/purchase/debit-notes` | `GET /purchase/debit-notes` |
| P21 | Supplier debit note | `PurDebitNote.html` | `/purchase/debit-notes/:id` | `GET/POST/PATCH …`, `POST …/submit-for-approval` · `/release` |
| P22 | Purchase return list | `PurReturnList.html` | `/purchase/returns` | `GET /purchase/returns` |
| P23 | Purchase return | `PurReturn.html` | `/purchase/returns/:id` (and `/new?grn=`) | `GET/POST/PATCH …`, `POST …/release`, `POST …/credit-note` |
| P24 | Approval rules | `PurPolicies.html` | `/purchase/settings/approval-rules` | `GET/PUT /purchase/settings/approval-rules` |
| P25 | Document types and numbering | `PurDocTypes.html` | `/purchase/settings/document-types` | `GET/PUT /purchase/settings/document-types` |
| P26 | Email templates | `PurEmailTemplates.html` | `/purchase/settings/email-templates` | `GET/PUT /purchase/settings/email-templates/:key` |

All API paths are under `/api/v1`.

### Purchase guide and flows (read before building)

| Board | File | What it tells you |
|---|---|---|
| UX guide | `PurUxGuide.html` | Patterns, three-way match, approval limits, the 7 rules, roles, numbers |
| Navigation map | `PurNavMap.html` | Menu tree from launcher to every screen |
| P1 | `FlowP1.html` | Demand → purchase request → RFQ or PO |
| P2 | `FlowP2.html` | RFQ → compare → award → draft PO |
| P3 | `FlowP3.html` | PO approval limits and release |
| P4 | `FlowP4.html` | Receiving goods, short deliveries |
| P5 | `FlowP5.html` | Supplier invoice and three-way match |
| P6 | `FlowP6.html` | Cancel balance, purchase return, supplier debit note |
| P7 | `FlowP7.html` | Cash purchase |

Each flow board ends with a **Step by step** table: what the user does, the rules the screen enforces, and what changes after. Treat that table as the acceptance criteria for the screen.

---

## Sales module (build after Purchase)

Theme: purple. Sidebar groups: **Sales Transaction**, **Billing**, **Operation Policies**, **Reports**.

| Code | Screen | Mockup | Route |
|---|---|---|---|
| S01 | Sales home | `Main.html` | `/sales` |
| S02 | Approvals inbox | `Approvals.html` | `/sales/approvals` |
| S03 | Document flow | `DocFlow.html` | `/sales/orders/:id/flow` |
| S04 | Add item from Master Data (dialog) | `ItemPicker.html` | dialog |
| S05 | Reports · sales by customer | `SalesReports.html` | `/sales/reports/:report` |
| S06 | Enquiry list | `EnquiryList.html` | `/sales/enquiries` |
| S07 | New enquiry | `EnquiryForm.html` | `/sales/enquiries/:id` |
| S08 | Quotation list | `QuotationList.html` | `/sales/quotations` |
| S09 | Quotation | `QuotationForm.html` | `/sales/quotations/:id` |
| S10 | Sales order list | `SalesOrderList.html` | `/sales/orders` |
| S11 | Sales order | `SalesOrderForm.html` | `/sales/orders/:id` |
| S12 | Credit check failed | `CreditApproval.html` | state of S11 |
| S13 | Cancel order list | `CancelOrderList.html` | `/sales/cancel-orders` |
| S14 | Cancel order balance | `CancelOrder.html` | `/sales/cancel-orders/:id` |
| S15 | Delivery orders | `DeliveryList.html` | `/sales/deliveries` |
| S16 | Confirm delivery | `DeliveryConfirm.html` | `/sales/deliveries/:id` |
| S17 | Invoice list | `InvoiceList.html` | `/sales/invoices` |
| S18 | Create invoice from order | `CreateInvoice.html` | `/sales/invoices/new` |
| S19 | Invoice | `InvoiceForm.html` | `/sales/invoices/:id` |
| S20 | Invoice print preview | `InvoicePrint.html` | `/sales/invoices/:id/print` |
| S21 | Proforma list | `ProformaList.html` | `/sales/proformas` |
| S22 | Proforma | `ProformaForm.html` | `/sales/proformas/:id` |
| S23 | Cash sales list | `CashSaleList.html` | `/sales/cash-sales` |
| S24 | Cash sale | `CashSale.html` | `/sales/cash-sales/:id` |
| S25 | Debit note list | `DebitNoteList.html` | `/sales/debit-notes` |
| S26 | Debit note | `DebitNote.html` | `/sales/debit-notes/:id` |
| S27 | Sales return list | `SalesReturnList.html` | `/sales/returns` |
| S28 | Sales return | `SalesReturn.html` | `/sales/returns/:id` |
| S29 | Credit control | `Policies.html` | `/sales/settings/credit-control` |
| S30 | Document types | `DocTypes.html` | `/sales/settings/document-types` |
| S31 | Enquiry types and sources | `EnquiryTypes.html` | `/sales/settings/enquiry-types` |
| S32 | Excluded items | `ExcludedItems.html` | `/sales/settings/excluded-items` |
| S33 | Email templates | `EmailTemplates.html` | `/sales/settings/email-templates` |

Sales guide and flows: `SalesUxGuide.html`, `SalesNavMap.html`, `FlowS1.html` … `FlowS6.html`.

---

## Core module (Master Data, phase 3)

Theme: indigo. Sidebar groups: **Items & Units**, **Customers & Suppliers**, **Prices & Tax**, **Warehouses & Locations**, **Setup**. Seed data: `CORE_SEED_DATA.md`. Core is the only module that writes `mdm_` tables; Purchase and Sales keep reading them through `MasterDataPort`.

The Core mockups were made in step C0, after the app's layout redesign, so they show the current shell (icon rail, group panel, floating top bar). Lists and forms follow the Purchase and Sales patterns. They were revised after checking the SRS and SDD: `CORE_SEED_DATA.md` → *Decided by the SRS and SDD* lists each rule with its reference.

The item, customer and supplier forms show where the record is used. Delete is possible only while nothing uses it. Block and Discontinue wait while an open Purchase or Sales document uses it. Core gets this from a read-only check that Purchase and Sales provide. Forms pick from `GET /api/v1/core/lookups/item-form` (item groups, units, tax codes, LHDN classification codes), `GET /api/v1/core/lookups/customer-form` (categories, areas, credit terms, branches, sales agents, price lists, ID types), `GET /api/v1/core/lookups/supplier-form` (payment terms, currencies, ID types), `GET /api/v1/core/lookups/suppliers?q=` and `GET /api/v1/core/lookups/purchasable-items?q=` (for contract prices). The same usage answer is at `GET /api/v1/core/usage/:kind/:code` (`item`, `customer`, `supplier`, `uom`, `tax-code`, `price-list`, `warehouse`), e.g. `/core/usage/item/CH-DIN-01`.

| Code | Screen | Mockup | Route | Main API |
|---|---|---|---|---|
| C01 | Core home | `CoreHome.html` | `/core` | GET /api/v1/core/dashboard |
| C02 | Item list | `CoreItemList.html` | `/core/items` | GET /api/v1/core/items |
| C03 | Item | `CoreItemForm.html` | `/core/items/:id` | GET, POST, PATCH /api/v1/core/items/:id (GET includes where it is used) · POST …/block, …/activate, …/discontinue · DELETE /api/v1/core/items/:id (only if never used) |
| C04 | Customer list | `CoreCustomerList.html` | `/core/customers` | GET /api/v1/core/customers |
| C05 | Customer | `CoreCustomerForm.html` | `/core/customers/:id` | GET, POST, PATCH /api/v1/core/customers/:id (credit fields need core.customer.credit; GET includes where it is used) · POST …/block, …/activate · DELETE /api/v1/core/customers/:id (only if never used) |
| C06 | Supplier list | `CoreSupplierList.html` | `/core/suppliers` | GET /api/v1/core/suppliers · GET /api/v1/core/suppliers/supplies (the *Supplies* filter) |
| C07 | Supplier with contract prices | `CoreSupplierForm.html` | `/core/suppliers/:id` | GET, POST, PATCH /api/v1/core/suppliers/:id (contract prices need core.supplier.contract; GET includes where it is used) · POST …/block, …/activate · DELETE /api/v1/core/suppliers/:id (only if never used) |
| C08 | Price lists | `CorePriceLists.html` | `/core/price-lists` | GET /api/v1/core/price-lists (prices, used by) |
| C09 | Price list with its prices | `CorePriceListForm.html` | `/core/price-lists/:id` | GET, POST, PATCH /api/v1/core/price-lists/:id (PATCH sends the prices from today on; earlier prices are history) · POST …/deactivate, …/activate · DELETE /api/v1/core/price-lists/:id (only if no customer or Sales document uses it) · GET /api/v1/core/lookups/sellable-items?q= (items with their units) |
| C10 | Tax codes | `CoreTaxCodes.html` | `/core/tax-codes` | GET, POST /api/v1/core/tax-codes · GET, PATCH, DELETE /api/v1/core/tax-codes/:code (by code: a code is all its rate periods; DELETE only if unused) · POST …/:code/rates (new rate) · DELETE …/:code/rates/:id (a rate that has not started) |
| C11 | Units of measure | `CoreUoms.html` | `/core/uoms` | GET, POST /api/v1/core/uoms · GET, PATCH, DELETE /api/v1/core/uoms/:id (delete only if never used) |
| C12 | Reference lists | `CoreReference.html` | `/core/reference` | GET /api/v1/core/reference (the four lists) · POST /api/v1/core/reference/:list · PATCH, DELETE …/:list/:id (`item-groups`, `customer-categories`, `areas`, `credit-terms`; tab in `?list=`) |
| C13 | Warehouses and locations (locations read only) | `CoreWarehouses.html` | `/core/warehouses` | GET /api/v1/core/warehouses (with their locations, read only) · POST · GET, PATCH, DELETE /api/v1/core/warehouses/:id (DELETE only if unused and without locations); selected warehouse in `?w=` |
| C14 | Import from CSV | `CoreImport.html` | `/core/import` | POST /api/v1/core/imports (check, saves nothing) · POST /api/v1/core/imports/:id/load (saves the rows that pass) · GET /api/v1/core/imports/:id/problems.csv |

