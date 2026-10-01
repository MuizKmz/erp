# Master Data contract

Master Data (Core) is the single owner of shared reference data. Sales, Purchase, WMS and MES **read** it; they never create or edit it. This file is the agreement between all modules, including the existing WMS and MES.

## The three rules

1. **Same code everywhere.** Every module uses the same business code for the same thing: item `FB-OAK-01`, supplier `S-0021`, customer `C-0012`, warehouse `HQ-MAIN`. Codes are what other systems match on. Internal IDs may differ per system; codes may not.
2. **Same meaning everywhere.** Units, tax codes, statuses and decimals mean the same thing in every module (see the field tables below).
3. **One owner, everyone else reads.** Only Master Data writes. Other modules read through an API and get told about changes by events (`mdm.item.updated` …). A document copies the values it needs at the moment it is created (a *snapshot*), so later changes in Master Data never rewrite old documents.

## How Purchase and Sales read Master Data

- Code depends on an interface (`MasterDataPort`), never on Master Data tables directly.
- **Phase 1 (now):** an adapter reads local seed tables prefixed `mdm_` in the same MySQL database.
- **Later:** a second adapter calls the real Master Data API. Swapping adapters must not change any Purchase or Sales code.
- Every document line stores both the reference and the snapshot: `itemId`, `itemCode`, `itemName`, `uomCode`, `taxCode`, `taxRate`, `unitPrice`.

## Entities

Owner is Master Data for all of them. “Used by” shows who reads it.

### Company and branch
| Field | Type | Notes |
|---|---|---|
| tenantId | string (uuid) | Every row in every table carries it. One tenant seeded for now |
| branch.code | string ≤ 10 | `HQ`, `PNG` |
| branch.name | string | `HQ Shah Alam`, `Penang Branch` |
| currency | string(3) | Base currency `MYR` |
Used by: all modules.

### Warehouse and location
| Field | Type | Notes |
|---|---|---|
| warehouse.code | string ≤ 20 | `HQ-MAIN`, `HQ-DMG` (damaged goods), `PNG-MAIN` |
| warehouse.branchCode | string | |
| location.code | string ≤ 30 | `HQ-MAIN/B-03` (rack). **Must match WMS location codes** |
| isActive | boolean | |
Used by: Purchase (receive to), Sales (deliver from, return to), WMS (owner of bins in practice — agree who maintains), MES.

### Item
| Field | Type | Notes |
|---|---|---|
| code | string ≤ 30 | `FB-OAK-01` |
| name | string | `Chair fabric roll, oatmeal` |
| itemGroup | string | `Fabric`, `Seating`, `Hardware`, `Service` |
| type | enum | `STOCK`, `NON_STOCK`, `SERVICE`, `ASSET` |
| baseUom | string | `ROLL`, `PCS`, `BOX`, `TIN`, `SET`, `LOT` |
| purchaseUom / salesUom | string | Optional; needs a conversion |
| isPurchasable / isSellable | boolean | Purchase hides items that are not purchasable |
| defaultTaxCode (purchase / sales) | string | `SST10`, `SVC8`, `EXEMPT` |
| preferredSupplierCode | string | `S-0021` |
| reorderLevel / packSize | decimal | Used by the demand list |
| status | enum | `ACTIVE`, `BLOCKED`, `DISCONTINUED` |
Used by: Sales, Purchase, WMS, MES.

### Unit of measure and conversion
| Field | Type | Notes |
|---|---|---|
| uom.code | string ≤ 10 | `ROLL`, `PCS`, `BOX`, `TIN`, `SET`, `LOT`, `M` |
| uom.decimals | int | `0` for PCS, `2` for M |
| conversion | itemCode, fromUom, toUom, factor | `FB-OAK-01: ROLL → M × 50`. **WMS and MES must use the same factors** |

### Tax code (Malaysia first, other countries later)
| Field | Type | Notes |
|---|---|---|
| code | string | `SST10` sales tax 10%, `SVC8` service tax 8%, `EXEMPT` 0% |
| rate | decimal(5,2) | |
| country | string(2) | `MY` |
| validFrom / validTo | date | Rates change; documents snapshot the rate |

### Supplier
| Field | Type | Notes |
|---|---|---|
| code | string | `S-0021` |
| name | string | `Kilang Kain Jaya Sdn Bhd` |
| regNo / tin / sstNo | string | For e-Invoice and tax |
| paymentTermDays | int | `30` |
| currency | string(3) | `MYR` |
| email / phone / address | string | PO and RFQ emails go here |
| status | enum | `ACTIVE`, `BLOCKED`. Purchase only uses active suppliers |
Used by: Purchase, WMS (inbound), Finance.

### Customer
| Field | Type | Notes |
|---|---|---|
| code | string | `C-0012` |
| name, tin, address, contacts | | |
| creditLimit / overdueLimit | decimal | Used by the Sales credit check |
| creditTermDays, priceListCode, defaultAgent | | |
| status | enum | `ACTIVE`, `BLOCKED`, `PROSPECT` |
Used by: Sales, WMS (outbound), Finance.

### User and role
| Field | Type | Notes |
|---|---|---|
| user.code / name / email | | `LMY`, `Lim Mei Ying` |
| branchCodes | string[] | Branches the user works in |
| roles | string[] | `PURCHASE_BUYER`, `PURCHASE_MANAGER`, `BRANCH_MANAGER`, `FINANCE_DIRECTOR`, `STORE`, `AP_CLERK`, `REQUESTER`, `ADMIN` |
Used by: all modules for approvals and audit.

## Checklist before connecting the existing WMS and MES

- [ ] List the item, warehouse, location, supplier and customer codes WMS and MES use today.
- [ ] Where codes differ, decide which system is the master and build a mapping table until they are merged.
- [ ] Agree unit conversions per item.
- [ ] Agree who maintains bin/location codes (usually WMS) and how Master Data learns about them.
- [ ] Agree the events in `EVENTS.md` and their payloads.
