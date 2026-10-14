# Seed data (Core)

The master data the Core module maintains (CLAUDE.md → *Phase 3 · Core module*). Core adds **no new demo records**: it takes over the master data that `SEED_DATA.md` (Purchase) and `SALES_SEED_DATA.md` (Sales) already load, and this file lists it in one place, the way the Core screens show it. Fields that Core adds get the values given below. "Today" is the same: **29 Sep 2026**.

Purchase and Sales keep reading this data through `MasterDataPort`, so nothing here may change a number on a Purchase or Sales screen. The mockups are `docs/design/mockups/Core*.html`; after seeding, the Core screens must show the numbers below.

## Core settings

- **Numbering** (`sys_number_sequence`, module `core`): customers `C-####`, next **C-0103**; suppliers `S-####`, next **S-0072**. Item, unit, warehouse, price-list and tax codes are typed.
- **Who changes what** (SRS §3.3):
  - Admin (ADM) also holds `MASTER_DATA_ADMIN` and changes everything.
  - Rosnah Ismail (Finance Manager) also changes customer credit.
  - Lim Mei Ying (buyer) and Ahmad Zaki (Purchasing Manager) also change suppliers. Only Ahmad Zaki and Admin change contract prices (choice 7).
  - Everyone else views. Sales agents never change master data.

## Core home (C01)

- **Counts:** items 39 (all active) · customers 7 · suppliers 10 · price lists 2 · tax codes 3 · units 9 · warehouses 3 with 8 locations.
- **Needs attention:**
  - 39 items have no e-Invoice classification code (a new field; choice 2).
  - 8 suppliers have no TIN or ID number: S-0009, S-0015, S-0021, S-0034, S-0047, S-0052, S-0061, S-0063 (walk-in shops left out; choice 3).
  - 6 customers have no ID number: C-0012, C-0031, C-0045, C-0056, C-0078, C-0102 (the cash customer left out; choice 3).
  - 3 purchasable items have no preferred supplier: OF-DSK-01, OF-TNR-01, SV-FRT-01.
  - Item groups “Service” and “Services” look like the same group (choice 1).
- **Recently changed:** empty on a fresh seed.

## Items (C02, C03): 39

| Code | Name | Group | Type | Unit | Buy | Sell | Preferred supplier | Purchase tax | Sales tax | Reorder | Pack | Standard cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BD-KNG-01 | King bed frame, teak | Beds | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 900.00 |
| CB-SHO-01 | Shoe cabinet | Cabinets | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 215.00 |
| CH-BAR-01 | Bar stool, oak | Seating | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 120.00 |
| CH-DIN-01 | Dining chair, solid oak | Seating | Stock | PCS | ✓ | ✓ | S-0047 Perabot Kayu Timur | SST10 | SST10 | 50 | 1 | 170.00 |
| CH-DIN-02 | Dining chair, walnut | Seating | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 182.00 |
| CH-DIN-09 | Dining chair, rattan | Seating | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 140.00 |
| CH-KID-01 | Kids chair, beech | Seating | Stock | PCS | — | — | — | SST10 | SST10 | — | 1 | 60.00 |
| CH-OFF-02 | Office chair, mesh | Seating | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 195.00 |
| CU-SET-02 | Seat cushion set | Soft goods | Stock | SET | — | ✓ | — | SST10 | SST10 | — | 1 | 32.00 |
| DR-RUN-04 | Drawer runner | Hardware | Stock | PCS | ✓ | — | S-0009 Hardware Mart Klang | SST10 | — | 20 | 1 | — |
| EL-EXT-01 | Extension cord | Electrical | Non-stock | PCS | ✓ | — | S-0071 Kedai Elektrik Jaya | SST10 | — | — | 1 | — |
| FB-GRY-02 | Chair fabric roll, grey | Fabric | Stock | ROLL | ✓ | — | S-0034 Tekstil Utara | SST10 | — | 30 | 1 | — |
| FB-OAK-01 | Chair fabric roll, oatmeal | Fabric | Stock | ROLL | ✓ | — | S-0021 Kilang Kain Jaya | SST10 | — | 50 | 1 | — |
| FM-SEA-05 | Seat foam sheet | Foam | Stock | PCS | ✓ | — | S-0034 Tekstil Utara | SST10 | — | 40 | 1 | — |
| HW-HNG-02 | Soft-close hinge, pack of 10 | Hardware | Stock | PACK | ✓ | — | S-0009 Hardware Mart Klang | EXEMPT | — | 10 | 1 | — |
| MJ-IND-01 | Industrial sewing machine | Machinery | Asset | PCS | ✓ | — | S-0052 Mesin Jahit Pro | EXEMPT | — | — | 1 | — |
| MJ-PF-11 | Presser foot set | Machine parts | Stock | SET | ✓ | — | S-0052 Mesin Jahit Pro | EXEMPT | — | 5 | 1 | — |
| OF-CLN-01 | Cleaning supplies | Office | Non-stock | LOT | ✓ | — | S-0070 Kedai Runcit Maju | EXEMPT | — | — | 1 | — |
| OF-DSK-01 | Standing desk | Office | Non-stock | PCS | ✓ | — | — | SST10 | — | — | 1 | — |
| OF-TNR-01 | Printer toner | Office | Non-stock | PCS | ✓ | — | — | SST10 | — | — | 1 | — |
| PT-SMP-01 | Sample paint tin | Finishing | Non-stock | TIN | ✓ | — | S-0015 Cat Warna | SST10 | — | — | 1 | — |
| PT-STN-03 | Wood stain, walnut, 5 L | Finishing | Stock | TIN | ✓ | — | S-0015 Cat Warna | SST10 | — | 20 | 1 | — |
| SC-WOD-08 | Wood screw 4 × 40 mm, box of 200 | Hardware | Stock | BOX | ✓ | — | S-0009 Hardware Mart Klang | SST10 | — | 20 | 10 | — |
| SF-BTH-02 | Booth seat, 2-seater | Sofas | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 760.00 |
| SF-CUS-03 | Custom 3-seater sofa, grey linen | Sofas | Stock | PCS | ✓ | ✓ (buy to order) | S-0047 Perabot Kayu Timur | SST10 | SST10 | 0 | 1 | 2,100.00 |
| ST-BAR-02 | Bar stool, metal | Stools | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 58.00 |
| SV-DEL-01 | Delivery trip, Klang Valley | Services | Service | TRIP | — | ✓ | — | SVC8 | SVC8 | — | 1 | 200.00 |
| SV-FRT-01 | Freight charge | Service | Service | LOT | ✓ | — | — | EXEMPT | — | — | 1 | — |
| SV-INS-01 | Installation and operator training | Service | Service | LOT | ✓ | — | S-0052 Mesin Jahit Pro | SVC8 | — | — | 1 | — |
| SV-TNT-01 | Paint tinting | Service | Service | LOT | ✓ | — | S-0015 Cat Warna | EXEMPT | — | — | 1 | — |
| TB-BED-01 | Bedside table | Tables | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 175.00 |
| TB-COF-01 | Coffee table, teak | Tables | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 760.00 |
| TB-DIN-06 | Dining table, 6-seater | Tables | Stock | PCS | ✓ | ✓ | S-0047 Perabot Kayu Timur | SST10 | SST10 | 5 | 1 | 865.40 |
| TB-OUT-02 | Outdoor table, teak | Tables | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 1,020.00 |
| TB-RST-04 | Restaurant table, 4-seater | Tables | Stock | PCS | — | ✓ | — | SST10 | SST10 | — | 1 | 540.00 |
| TL-DRL-01 | Drill bit set | Tools | Non-stock | SET | ✓ | — | S-0009 Hardware Mart Klang | SST10 | — | — | 1 | — |
| TM-OAK-01 | Oak timber plank | Timber | Stock | PCS | ✓ | — | S-0047 Perabot Kayu Timur | SST10 | — | — | 1 | — |
| VN-TEK-01 | Teak veneer sheet | Timber | Stock | PCS | ✓ | — | S-0063 Venir Jaya | SST10 | — | — | 1 | — |
| VR-LAC-01 | Lacquer, 5 L | Finishing | Stock | TIN | ✓ | — | S-0015 Cat Warna | SST10 | — | 10 | 4 | — |

- All items are `ACTIVE`. The item form mockup (C03) shows **CH-DIN-01**: on Standard 2026 at 250.00 and Reseller 2026 at 235.00, no contract price, no conversion.
- Items with a barcode are the sellable furniture; none of the bought-only items has one.

## Units of measure (C11): 9

| Code | Name | Decimals | Base unit of |
|---|---|---|---|
| BOX | Box | 0 | 1 item |
| LOT | Lot | 0 | 4 items |
| M | Metre | 2 | 0 items |
| PACK | Pack | 0 | 1 item |
| PCS | Piece | 0 | 24 items |
| ROLL | Roll | 0 | 2 items |
| SET | Set | 0 | 3 items |
| TIN | Tin | 0 | 3 items |
| TRIP | Trip | 0 | 1 item |

- **Conversion:** FB-OAK-01 (Chair fabric roll, oatmeal): 1 ROLL = 50 M. The only conversion seeded.

## Customers (C04, C05): 7

| Code | Name | Category · area | Branch | Sales agent | Price list | Credit term | Credit limit | Overdue limit | TIN | Tax mode |
|---|---|---|---|---|---|---|---|---|---|---|
| C-0012 | Hotel Seri Bayu Sdn Bhd | Hospitality · Central | HQ | Aina Rahman | Standard 2026 | 30 days | 150,000.00 | 5,000.00 | C20881234050 | Exclusive |
| C-0031 | Kedai Perabot Maju | Reseller · Northern | PNG | Lim Wei Jie | Reseller 2026 | 30 days | 60,000.00 | 15,000.00 | C21550098010 | Exclusive |
| C-0045 | Syarikat Delta Trading | Trading · Central | HQ | Faizal Omar | Standard 2026 | 30 days | 20,000.00 | 3,000.00 | C10334570020 | Exclusive |
| C-0056 | Restoran Selera Kampung | Food and beverage · Northern | PNG | Faizal Omar | Standard 2026 | 30 days | 15,000.00 | 3,000.00 | IG22018845030 | Exclusive |
| C-0078 | Klinik Sihat Jaya | Healthcare · Central | HQ | Faizal Omar | Standard 2026 | 30 days | 15,000.00 | 5,000.00 | C24410922080 | Exclusive |
| C-0102 | Villa Damai Resort | Hospitality · Central | HQ | Aina Rahman | Standard 2026 | 30 days | 50,000.00 | 5,000.00 | C26110473040 | Exclusive |
| C-CASH | Cash customer (walk-in) | Walk-in | HQ | — | Standard 2026 | Cash | no limit | no limit | — | Inclusive |

- All `ACTIVE`; no prospects or blocked customers. None overrides the credit scope (all follow Credit Control, group-wide).
- **e-Invoice identity** (SRS FR-MST-042), new fields: ID type is `BRN` for every customer (the SRS default; C-CASH has none). ID number, sales tax no, service tax no and e-Invoice email are empty for all.
- The customer form mockup (C05) shows **C-0012 Hotel Seri Bayu Sdn Bhd**.

## Suppliers (C06, C07): 10

| Code | Name | Short name | Supplies | TIN | Sales tax no | Payment term | Email | Walk-in |
|---|---|---|---|---|---|---|---|---|
| S-0009 | Hardware Mart Klang | Hardware Mart Klang | Hardware | — | — | 30 days | orders@hardwaremartklang.my | — |
| S-0015 | Cat Warna Sdn Bhd | Cat Warna | Lacquer, stain | — | SST-0015 | 30 days | sales@catwarna.my | — |
| S-0021 | Kilang Kain Jaya Sdn Bhd | Kilang Kain Jaya | Fabric | — | SST-0021 | 30 days | sales@kilangkainjaya.my | — |
| S-0034 | Tekstil Utara Enterprise | Tekstil Utara | Fabric, foam | — | SST-0034 | 30 days | sales@tekstilutara.my | — |
| S-0047 | Perabot Kayu Timur | Perabot Kayu Timur | Furniture, timber | — | SST-0047 | 30 days | sales@perabotkayutimur.my | — |
| S-0052 | Mesin Jahit Pro Sdn Bhd | Mesin Jahit Pro | Sewing machines and parts | — | SST-0052 | 30 days | accounts@mesinjahitpro.my | — |
| S-0061 | Kilang Perabot Selatan | Perabot Selatan | Furniture | — | SST-0061 | 30 days | sales@perabotselatan.my | — |
| S-0063 | Venir Jaya Enterprise | Venir Jaya | Veneer | — | SST-0063 | 30 days | sales@venirjaya.my | — |
| S-0070 | Kedai Runcit Maju | Kedai Runcit Maju | Walk-in shop | — | — | 30 days | — | yes |
| S-0071 | Kedai Elektrik Jaya | Kedai Elektrik Jaya | Walk-in shop | — | SST-0071 | 30 days | — | yes |

- **Contract price:** SF-CUS-03 from S-0047 at RM 2,100.0000, 1 Jan 2026 – 31 Dec 2026. The only one seeded (it is why SF-CUS-03 skips the RFQ).
- **e-Invoice identity** (SRS FR-MST-042): ID type `BRN` for all. The ID number is the existing registration number, empty for all. Service tax no and e-Invoice email are new and empty. The seeded SST number is shown as the sales tax no.
- The supplier form mockup (C07) shows **S-0047 Perabot Kayu Timur**.

## Price lists (C08, C09): 2

| Code | Name | Currency | Prices | Valid | Customers |
|---|---|---|---|---|---|
| RES-2026 | Reseller 2026 | MYR, exclude tax | 6 | 1 Jan 2026 – 31 Dec 2026 | 1: C-0031 |
| STD-2026 | Standard 2026 | MYR, exclude tax | 17 | 1 Jan 2026 – 31 Dec 2026 | 6: C-0012, C-0045, C-0056, C-0078, C-0102, C-CASH |

**Reseller 2026**

| Item | Unit | Price (RM) |
|---|---|---|
| CH-BAR-01 Bar stool, oak | PCS | 180.00 |
| CH-DIN-01 Dining chair, solid oak | PCS | 235.00 |
| CH-DIN-02 Dining chair, walnut | PCS | 265.00 |
| CH-DIN-09 Dining chair, rattan | PCS | 210.00 |
| CH-OFF-02 Office chair, mesh | PCS | 285.00 |
| TB-DIN-06 Dining table, 6-seater | PCS | 1,380.00 |

**Standard 2026**

| Item | Unit | Price (RM) |
|---|---|---|
| BD-KNG-01 King bed frame, teak | PCS | 1,400.00 |
| CB-SHO-01 Shoe cabinet | PCS | 350.00 |
| CH-BAR-01 Bar stool, oak | PCS | 190.00 |
| CH-DIN-01 Dining chair, solid oak | PCS | 250.00 |
| CH-DIN-02 Dining chair, walnut | PCS | 280.00 |
| CH-DIN-09 Dining chair, rattan | PCS | 220.00 |
| CH-OFF-02 Office chair, mesh | PCS | 300.00 |
| CU-SET-02 Seat cushion set | SET | 60.00 |
| SF-BTH-02 Booth seat, 2-seater | PCS | 1,190.00 |
| SF-CUS-03 Custom 3-seater sofa, grey linen | PCS | 3,200.00 |
| ST-BAR-02 Bar stool, metal | PCS | 100.00 |
| SV-DEL-01 Delivery trip, Klang Valley | TRIP | 350.00 |
| TB-BED-01 Bedside table | PCS | 280.00 |
| TB-COF-01 Coffee table, teak | PCS | 1,200.00 |
| TB-DIN-06 Dining table, 6-seater | PCS | 1,450.00 |
| TB-OUT-02 Outdoor table, teak | PCS | 1,600.00 |
| TB-RST-04 Restaurant table, 4-seater | PCS | 850.00 |

Every seeded price is valid from its list's start date (1 Jan 2026). No quantity breaks (choice 9). The price list mockup (C09) shows **STD-2026**.

## Tax codes (C10): 3

| Code | Name | Type | Rate | Country | Valid from | Items (buying · selling) |
|---|---|---|---|---|---|---|
| EXEMPT | Exempt | Exempt | 0% | MY | 1 Sep 2018 | 6 · 0 |
| SST10 | SST 10% | Sales tax | 10% | MY | 1 Sep 2018 | 31 · 17 |
| SVC8 | Service tax 8% | Service tax | 8% | MY | 1 Mar 2024 | 2 · 1 |

No rate history yet: each code has one rate, open-ended. *Type* is new (SRS FR-MST-055) and seeded as shown.

## Reference lists (C12)

New tables in C1, filled from the values the seeded records already use:

- **Item groups (19):** Beds (1), Cabinets (1), Electrical (1), Fabric (2), Finishing (3), Foam (1), Hardware (3), Machine parts (1), Machinery (1), Office (3), Seating (6), Service (3), Services (1), Sofas (2), Soft goods (1), Stools (1), Tables (5), Timber (2), Tools (1).
- **Customer categories (6):** Food and beverage, Healthcare, Hospitality, Reseller, Trading, Walk-in.
- **Areas (2):** Central, Northern.
- **Credit terms (2):** Cash (0 days), 30 days.

## Warehouses and locations (C13): 3 and 8

| Warehouse | Name | Branch | Locations |
|---|---|---|---|
| HQ-DMG | HQ Shah Alam · damaged goods | HQ · HQ Shah Alam | HQ-DMG/Q-01 |
| HQ-MAIN | HQ Shah Alam · main | HQ · HQ Shah Alam | HQ-MAIN/B-01, HQ-MAIN/B-02, HQ-MAIN/B-03, HQ-MAIN/B-04, HQ-MAIN/B-05 |
| PNG-MAIN | Penang · main | PNG · Penang Branch | PNG-MAIN/A-01, PNG-MAIN/A-02 |

Core edits warehouses (the Master Data contract puts them in Core). **Locations are read only**: bins and stock locations belong to Inventory, which here means the WMS (SRS FR-INV-001, SDD §6.1). Until the WMS is connected, the seeded locations are the opening ones.

## In use (C03, C05, C07)

Core asks Purchase and Sales where a record is used, through a read-only check that each of them provides. It never reads their tables. The same answer is at `GET /api/v1/core/usage/:kind/:code`, e.g. `/core/usage/item/CH-DIN-01`.

- **Delete** is possible only while nothing uses the record: no Purchase or Sales document of any status, and no other Core record. After that it is blocked, discontinued or ended instead (SRS DR-002, FR-MST-049).
- **Block and Discontinue** wait while an *open* document uses the item, customer or supplier (SDD §5.3.1). The form lists those documents.
- **Open** means a draft, a document waiting for approval, or a released document with something left to deliver, receive, invoice or bill. Released invoices waiting for payment do not count (choice 6).

What the mockups show, from the seeded Purchase and Sales data:

| Record | Used on | Still open |
|---|---|---|
| CH-DIN-01 (C03) | 19 Sales documents | 7: SO-0001 Partial, SO-0002 Pending approval, SO-0005 Draft, SO-0008 Pending approval, QT-0010 Released, QT-0012 Draft, CS-0004 Draft |
| C-0012 (C05) | 23 Sales documents | 5: SO-0001 Partial, SO-0003 Released, QT-0006 Draft, DN-0001 Draft, EQ-L-0307 New |
| S-0047 (C07) | 6 Purchase documents | 3: PO-0003 Pending approval, RFQ-0003 Waiting, RFQ-0004 Waiting |

A document counts once: QT-0010 has two revisions and is one quotation. DO-0001 is not open (all 60 delivered are invoiced on INV-0001). C-0012's seven released invoices do not count.

## Import (C14)

- **Check** reads the file and shows each row as *new*, *update* or *problem*. Nothing is saved.
- **Load** saves the rows that passed, each on its own, so one bad row never stops the others.
- The rows with a problem are left out. *Download rows with problems* gives them back as a CSV to fix and upload again (SRS BR-STA-005, DR-005, INT-013; SDD §9.6, §12.4).
- Codes decide: a known code updates that record, and an empty code adds a new one with the next number.
- Kinds of import: customers, suppliers, items and price-list prices. Imports go through the same rules as the screens (SRS BR-VAL-020).

Nothing is seeded. The mockup's example rows (Taman Indah Hotel, Hotel Seri Bayu with a new phone number, Kedai Baru in a branch KL that does not exist) are *invented* to show a new record, an update and a row with a problem.

## Decided by the SRS and SDD

Checked against `docs/requirements/ERP_SRS.md` and `ERP_SDD.md` after the first review. These are rules, not choices.

| Topic | Rule | Source |
|---|---|---|
| Approval | Master-data changes need no approval; approvals are for documents. Every change is logged with the old and new values. | SRS FR-SEC-050, FR-WFL-001, NFR-AUD-001, DR-003 |
| Codes | Customers `C-####`, suppliers `S-####` from numbering; codes unique per tenant. A code never changes (Master Data contract rule 1). | SRS FR-MST-048, DR-004; SDD §8.3 |
| Delete | Only while nothing uses the record; after that block, discontinue or end it. | SRS DR-002, FR-MST-049; SDD §7.3 |
| Block, discontinue | Not while an open document uses the item, customer or supplier. | SDD §5.3.1 |
| Who edits | Sales agents only read master data; buyers also maintain suppliers. | SRS §3.3 |
| Locations | Bins and stock locations belong to Inventory (the WMS), so Core shows them read only. | SRS FR-INV-001; SDD §6.1 |
| e-Invoice fields | Items carry a classification code. Customers and suppliers carry TIN, ID type and number (BRN, NRIC, PASSPORT, ARMY), sales and service tax numbers and an e-Invoice email. Gaps are flagged when the record is entered. | SRS FR-MST-008, FR-MST-042, Appendix E; SDD §12.2 |
| Tax codes | Each code has a type; rates are effective-dated. | SRS FR-MST-055, BR-TAX-006; SDD §8.3 |
| Prices | Dated prices with history; a future price waits for its date. | SRS FR-MST-031, FR-MST-032, BR-PRC-003, BR-PRC-004 |
| Import | Check first, saving nothing. Load the rows that pass, each on its own. Rows with a problem come back to fix. | SRS BR-STA-005, DR-005, INT-013, BR-VAL-020; SDD §9.6, §12.4 |

## Choices made

Not covered by the SRS or SDD. The user approved these defaults in C0.

| # | Where | Question | Choice |
|---|---|---|---|
| 1 | C12, C01 | SV-DEL-01's group is “Services”; the other service items say “Service”. | Leave it as seeded and flag it under *Needs attention*. Merging into “Service” is one change in Core once you say so. |
| 2 | C03, C01 | No LHDN classification codes are known yet. | Empty for all 39 items and flagged. They are filled in Core (or by import) when you have them. |
| 3 | C05, C07, C01 | No supplier TINs and no ID numbers are known yet. | Empty and flagged. Walk-in shops and the cash customer are not flagged. |
| 4 | Sidebar | The plan does not group the screens. | Five groups: Items & Units, Customers & Suppliers, Prices & Tax, Warehouses & Locations, Setup (Reference Lists, Import). |
| 5 | C05 | Prospect to customer (decision 7); the SRS has no prospects, they come from FlowS1. | The customer form has *Came from enquiry*. For a new customer it takes the enquiry number, and Sales links that enquiry. |
| 6 | C03, C05, C07 | What counts as an open document for Block and Discontinue. | Drafts, documents waiting for approval, and released documents with something left to deliver, receive, invoice or bill. Released invoices waiting for payment do not count, so a customer who does not pay can still be blocked. |
| 7 | C07 | Buyers maintain suppliers (SRS §3.3). Who changes contract prices? | Only the Purchasing Manager and the Master Data Admin, because a contract price lets an order skip the RFQ (Purchase rule 4). |
| 8 | C05, C07 | FR-MST-042 also lists *tax registration number* and *tax type*. | Left out: the SRS does not say what they hold, and MyInvois does not ask for them. The customer keeps its *Tax mode*. Each is one field to add if your old system uses it. |
| 9 | C09 | Quantity breaks on prices (SRS FR-MST-030). | Later, together with the Sales change that applies them. Sales does not use them today, so a break entered in Core would do nothing. |
| 10 | C10 | *Exemption permitted* on tax codes (SRS FR-MST-055). | Comes with tax exemptions, which are not in Phase 3. |
| 11 | C05 | Who sets credit limits; the SRS does not say. | The Finance Manager and the Master Data Admin (`core.customer.credit`). |
| 12 | C03 | Who sees an item's standard cost in Core? It gives the estimated margin, which Sales shows only to the Sales Manager. | Only those who edit items. Everyone else sees the item without it. |
| 13 | C03 | Which LHDN classification codes can an item pick? | The 45 codes of the MyInvois SDK's *Classification Codes*, kept in one file (`core/shared/einvoice-classifications.ts`). Check them against the current SDK before go-live. |
| 14 | C03 | A sell-only item has no purchase tax, but the column cannot be empty. | It keeps its sales tax code there. Purchase never uses an item that cannot be bought. |
| 15 | C02 | How many items to a page? | 14, as in the mockup (*Page 1 of 3*). |
| 16 | C05 | How does a prospect get into Master Data? | *New customer* has **Save customer** (active, Sales can quote it) and **Save as prospect** (kept out of quotations until someone clicks *Make customer*). |
| 17 | C05 | The mockup's *Credit checked* says “As Credit Control says (group-wide)”. | Core cannot read Sales' Credit Control setting, so it says “As Credit Control says”. The customer can also be set to group-wide or per branch, whatever Credit Control says. |
| 18 | C05 | The price list sits in the credit card in the mockup. Is it a credit field? | No: changing it needs `core.customer.edit`. The credit fields are the credit term, the two limits and *Credit checked* (decision 2). |
| 19 | C05 | What if *Came from enquiry* names an enquiry Sales does not have, or one that already has a customer? | The customer is still saved. Sales links nothing, and says so in that enquiry's activity when it exists. |
