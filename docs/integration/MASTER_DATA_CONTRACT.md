# Master Data contract

Master Data (Core) is the single owner of shared reference data. Sales, Purchase, WMS and MES **read** it; they never create or edit it. The one exception is storage locations, which the WMS maintains (see *Warehouse and location*). This file is the agreement between all modules, including the existing WMS and MES.

## The three rules

1. **Same code everywhere.** Every module uses the same business code for the same thing: item `FB-OAK-01`, supplier `S-0021`, customer `C-0012`, warehouse `HQ-MAIN`. Codes are what other systems match on. Internal IDs may differ per system; codes may not.
2. **Same meaning everywhere.** Units, tax codes, statuses and decimals mean the same thing in every module (see the field tables below).
3. **One owner, everyone else reads.** Only Master Data writes. Other modules read through an API and get told about changes by events (`mdm.item.updated` …). A document copies the values it needs at the moment it is created (a *snapshot*), so later changes in Master Data never rewrite old documents.

## Life of a record

Decided in Phase 3 from SRS DR-002, FR-MST-049 and SDD §5.3.1:

- A code never changes once it is saved.
- A record that nothing has used yet can be deleted, and `mdm.<record>.deleted` is published.
- Once any document uses a record, it is never deleted. It is blocked, discontinued or ended instead, and stays readable.
- An item, customer or supplier is not blocked or discontinued while an open document uses it.
- Master Data learns where a record is used from each module, through a read-only check, without reading the module's tables.

## How Purchase and Sales read Master Data

- Code depends on an interface (`MasterDataPort`), never on Master Data tables directly.
- **Now:** an adapter reads the `mdm_` tables in the same MySQL database. The Core module (Phase 3) maintains them, with an audit trail and `mdm.*` events; before Phase 3 only the seed filled them.
- **Later:** a second adapter calls the real Master Data API. Swapping adapters must not change any Purchase or Sales code.
- Every document line stores both the reference and the snapshot: `itemId`, `itemCode`, `itemName`, `uomCode`, `taxCode`, `taxRate`, `unitPrice`.

## Entities

Owner is Master Data for all of them, except locations (WMS). “Used by” shows who reads it.

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
Used by: Purchase (receive to), Sales (deliver from, return to), WMS, MES. **Locations are maintained by the WMS** (SRS FR-INV-001, SDD §6.1). Core edits warehouses and shows locations read only.

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
| einvoiceClassification | string | LHDN classification code for e-Invoice lines (added in Phase 3) |
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
| type | enum | `SALES_TAX`, `SERVICE_TAX`, `EXEMPT` (added in Phase 3) |
| rate | decimal(5,2) | |
| country | string(2) | `MY` |
| validFrom / validTo | date | Rates change; documents snapshot the rate |

### Supplier
| Field | Type | Notes |
|---|---|---|
| code | string | `S-0021` |
| name | string | `Kilang Kain Jaya Sdn Bhd` |
| tin, idType, regNo, sstNo, serviceTaxNo, einvoiceEmail | string | e-Invoice identity. `idType` is `BRN`, `NRIC`, `PASSPORT` or `ARMY`, and `regNo` is the ID number. `sstNo` is the sales tax number. `idType`, `serviceTaxNo` and `einvoiceEmail` were added in Phase 3 |
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
| idType, idNumber, salesTaxNo, serviceTaxNo, einvoiceEmail | string | e-Invoice identity (added in Phase 3). `idType` as for suppliers |
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
- [x] Who maintains bin/location codes: the WMS (decided in Phase 3).
- [ ] Agree how Master Data learns about WMS locations (event or API).
- [ ] Agree the events in `EVENTS.md` and their payloads.
