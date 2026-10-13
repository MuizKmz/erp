# Seed data (Purchase)

The mockups tell one consistent story. Seed exactly this data so every built screen can be compared with its mockup side by side. “Today” in the mockups is **Tuesday 29 Sep 2026**. Amounts are MYR. SST is 10%, service tax 8%.

Documents ending in `-L-` are migrated from the old system: seed them read-only with `isMigrated = true`.

## Master data (local `mdm_` tables for now)

**Branches and warehouses**

| Branch | Warehouses |
|---|---|
| HQ · HQ Shah Alam | HQ-MAIN (racks HQ-MAIN/B-03 …), HQ-DMG (damaged goods) |
| PNG · Penang Branch | PNG-MAIN |

**Users**

| Code | Name | Email | Roles |
|---|---|---|---|
| LMY | Lim Mei Ying | meiying@warehouse.com | PURCHASE_BUYER, AP_CLERK |
| AZ | Ahmad Zaki | zaki@warehouse.com | PURCHASE_MANAGER |
| TWL | Tan Wei Ling | weiling@warehouse.com | BRANCH_MANAGER (PNG) |
| RI | Rosnah Ismail | rosnah@warehouse.com | FINANCE_DIRECTOR |
| RAH | Rahim | rahim@warehouse.com | STORE, REQUESTER |
| NUR | Nurul | nurul@warehouse.com | REQUESTER (Production) |
| HAF | Hafiz | hafiz@warehouse.com | REQUESTER (Production), STORE |
| SIT | Siti | siti@warehouse.com | REQUESTER (Office) |
| ADM | Admin | admin@warehouse.com | ADMIN |

**Suppliers** (all ACTIVE, payment term 30 days, MYR)

| Code | Name | Notes |
|---|---|---|
| S-0021 | Kilang Kain Jaya Sdn Bhd | Fabric. On time 96% of 24 deliveries. sales@kilangkainjaya.my |
| S-0034 | Tekstil Utara Enterprise | Fabric, foam. On time 88% of 9 |
| S-0009 | Hardware Mart Klang | Hardware. On time 81%. Not SST registered (legacy POs without tax) |
| S-0047 | Perabot Kayu Timur | Furniture, timber |
| S-0052 | Mesin Jahit Pro Sdn Bhd | Sewing machines and parts. accounts@mesinjahitpro.my |
| S-0015 | Cat Warna Sdn Bhd | Lacquer, stain |
| S-0061 | Kilang Perabot Selatan | Furniture (RFQ only) |
| S-0063 | Venir Jaya Enterprise | Veneer (RFQ only) |
| S-0070 | Kedai Runcit Maju | Walk-in shop (cash purchase) |
| S-0071 | Kedai Elektrik Jaya | Walk-in shop (cash purchase) |

**Items**

Stock on hand comes from a read-only stub (`inv_stock_snapshot`) until the Inventory module is connected. That is why FB-OAK-01 still shows 30 after GRN-0001: the stock-in event is waiting for Inventory, exactly as the mockups say.

| Code | Name | UOM | Type | Purchase tax | Last price | Preferred supplier | Reorder | Stock on hand |
|---|---|---|---|---|---|---|---|---|
| FB-OAK-01 | Chair fabric roll, oatmeal | ROLL | STOCK | SST10 | 40.00 | S-0021 | 50 | 30 |
| FB-GRY-02 | Chair fabric roll, grey | ROLL | STOCK | SST10 | 40.00 | S-0034 | 30 | 40 |
| FM-SEA-05 | Seat foam sheet | PCS | STOCK | SST10 | 35.00 | S-0034 | 40 | 12 |
| SC-WOD-08 | Wood screw 4 × 40 mm, box of 200 | BOX | STOCK | SST10 | 18.00 | S-0009 | 20 | 5 |
| VR-LAC-01 | Lacquer, 5 L | TIN | STOCK | SST10 | 95.00 | S-0015 | 10 | 3 |
| PT-STN-03 | Wood stain, walnut, 5 L | TIN | STOCK | SST10 | 155.00 | S-0015 | 20 | 6 |
| HW-HNG-02 | Soft-close hinge, pack of 10 | PACK | STOCK | EXEMPT | 21.60 | S-0009 | 10 | 20 |
| DR-RUN-04 | Drawer runner | PCS | STOCK | SST10 | 12.00 | S-0009 | 20 | 8 |
| CH-DIN-01 | Dining chair, solid oak | PCS | STOCK | SST10 | 150.00 | S-0047 | 50 | 0 |
| TB-DIN-06 | Dining table, 6-seater | PCS | STOCK | SST10 | 820.00 | S-0047 | 5 | 4 |
| SF-CUS-03 | Custom 3-seater sofa, grey linen | PCS | STOCK (buy to order) | SST10 | 2,100.00 | S-0047 | 0 | 0 |
| MJ-IND-01 | Industrial sewing machine | PCS | ASSET | EXEMPT | 25,000.00 | S-0052 | — | — |
| MJ-PF-11 | Presser foot set | SET | STOCK | EXEMPT | 109.00 | S-0052 | 5 | 2 |
| SV-INS-01 | Installation and operator training | LOT | SERVICE | SVC8 | 500.00 | S-0052 | — | — |
| OF-TNR-01 | Printer toner | PCS | NON_STOCK | SST10 | 90.00 | — | — | — |

**Demand list on 29 Sep (P04)** — the seed must reproduce it: SC-WOD-08 buy 20, TB-DIN-06 buy 1 and VR-LAC-01 buy 8 (below reorder, selected), CH-DIN-01 buy 90 (40 for SO-0001 + top up to 50). Already covered: SF-CUS-03 by PO-0003, FB-OAK-01 by PO-0001 and PO-0004 (65 on order), FM-SEA-05 by PO-0005. Estimated value RM 15,440.00. Sales-order needs come from released Sales orders: Purchase keeps its own copy, fed by Sales events. The mockup's TB-DIN-06 buy 31 and RM 40,040.00 came from a demo SO-0008 that is not a released order (`SALES_SEED_DATA.md`, conflict 16).

## Settings

- **Approval rules:** HQ PO over RM 10,000.00 → Purchasing Manager (Ahmad Zaki). Penang PO over RM 5,000.00 → Branch Manager (Tan Wei Ling). Any PO over RM 50,000.00 → also Finance Director (Rosnah Ismail). Invoice outside tolerance → Purchasing Manager. Debit note with a charge not on the PO → Purchasing Manager. Cash purchase over RM 1,000.00 → blocked.
- **Tolerance:** price ±2%, quantity 0 over received, tax ±RM 1.00.
- **Switches:** RFQ needed over RM 50,000.00 (on) · allow over-receipt (off) · auto-draft PO for buy-to-order sales lines (on) · only active suppliers (on) · buyer cannot approve own PO (on).
- **Numbering:** PRQ, RFQ, PO, GRN, PI, CP, PDN, PRT, PCO, 4 digits, never reset. Next numbers after seeding: PRQ-0007, RFQ-0005, PO-0007, GRN-0004, PI-0004, CP-0003, PDN-0002, PRT-0002, PCO-0002.
- **Email templates:** PO to supplier, RFQ request, RFQ not awarded, Delivery reminder, Invoice difference, Cancellation notice, Return notice, Approval request. Variables use single braces: `{po.number}`.

## The main case (follow it through every screen)

| Doc | Date | Facts |
|---|---|---|
| PRQ-0001 | 22 Sep | Rahim (Store, HQ). FB-OAK-01 × 100, needed by 30 Sep. Reason: below reorder (30 left, reorder 50), for SO-0001 chairs. Converted |
| RFQ-0001 | 22 Sep | Asked S-0021 and S-0034. S-0021: 40.00, 1 week, MOQ 50, valid 6 Oct, quote KKJ-Q-5512. S-0034: 38.00, 3 weeks, MOQ 100, valid 13 Oct. Awarded S-0021 on 23 Sep with reason “Tekstil Utara is RM 200.00 cheaper but cannot deliver before 14 Oct” |
| PO-0001 | 23 Sep | S-0021, 100 × 40.00 = 4,000.00 + SST 400.00 = **4,400.00**. No approval (under RM 10,000). Released 23 Sep 11:02. Expected 30 Sep, HQ-MAIN. Partially received |
| GRN-0001 | 25 Sep | 95 of 100 received by Rahim, DO KKJ-DO-7781, vehicle BKL 4471, rack HQ-MAIN/B-03. 5 short, kept open (supplier promised 2 Oct) |
| PI-0001 | 26 Sep | Supplier invoice KKJ-INV-10442 billed 100 rolls = 4,400.00. Recorded only received: 95 × 40 = 3,800 + 380 = **4,180.00**. Approved. Due 26 Oct |
| PRT-0001 | 28 Sep | 10 rolls back, wrong colour (sand, batch KKJ-B-2209). RMA KKJ-RMA-0219. 400.00 + 40.00 = 440.00 credit expected. Collected 30 Sep |

## Other Purchase documents

**Purchase requests**

| No | Date | By | What | Value | Status / became |
|---|---|---|---|---|---|
| PRQ-0006 | 29 Sep | Rahim | SC-WOD-08 × 20, VR-LAC-01 × 8 | 1,120.00 | Draft |
| PRQ-0005 | 29 Sep | Siti | OF-TNR-01 × 6 | 540.00 | Submitted |
| PRQ-0004 | 28 Sep | Rahim (Penang) | FB-OAK-01 × 60 | 2,400.00 | Converted → PO-0004 |
| PRQ-0003 | 28 Sep | Nurul | FM-SEA-05 × 40 | 1,400.00 | Converted → RFQ-0002 → PO-0005 |
| PRQ-0002 | 24 Sep | Hafiz | MJ-IND-01 × 1 | 25,000.00 | Converted → PO-0002 |
| PRQ-L-0144 | 18 Sep | Siti | Standing desk × 4 | 3,600.00 | Rejected (no budget) |
| PRQ-L-0141 | 16 Sep | Nurul | VR-LAC-01 × 12 | 1,140.00 | Converted → PO-L-0877 |
| PRQ-L-0139 | 10 Sep | Hafiz | Oak timber plank × 200 | 9,000.00 | Converted → RFQ-L-0058 |

**RFQs**: RFQ-0004 (29 Sep, teak veneer sheet × 50, asked S-0047, S-0009, S-0063, 0 replies, reply by 2 Oct) · RFQ-0003 (28 Sep, TB-DIN-06 × 30 for SO-0008, asked S-0047 and S-0061; S-0047 replied 1,450.00 each, 4 weeks; reply by 1 Oct) · RFQ-0002 (24 Sep, FM-SEA-05 × 40, 3 replies, awarded S-0034 → PO-0005) · RFQ-L-0058 (awarded S-0047) · RFQ-L-0055 (closed, too costly).

**Purchase orders** (11 in total, RM 96,450.00 including tax)

| No | Date | Supplier | Lines | Total | Received | Status |
|---|---|---|---|---|---|---|
| PO-0006 | 29 Sep | S-0009 | DR-RUN-04 × 30 @ 12.00 | 396.00 | 0/30 | Draft |
| PO-0005 | 28 Sep | S-0034 | FM-SEA-05 × 40 @ 35.00 | 1,540.00 | 0/40 | Draft |
| PO-0004 | 28 Sep | S-0021 | FB-OAK-01 × 60 @ 40.00, Penang | 2,640.00 | 0/60 | Released, expected 5 Oct |
| PO-0003 | 27 Sep | S-0047 | SF-CUS-03 × 20 @ 2,100.00, for SO-0003 (buy to order, auto-drafted) | 46,200.00 | 0/20 | Pending approval (Ahmad Zaki), expected 9 Oct |
| PO-0002 | 24 Sep | S-0052 | MJ-IND-01 × 1 @ 25,000.00 (EXEMPT) | 25,000.00 | 1/1 (GRN-0002, 26 Sep) | Done, approved 24 Sep |
| PO-0001 | 23 Sep | S-0021 | see main case | 4,400.00 | 95/100 | Partially received |
| PO-L-0882 | 21 Sep | S-0052 | MJ-PF-11 × 8 @ 109.00 | 872.00 | 0/8 | Released, expected 2 Oct |
| PO-L-0879 | 21 Sep | S-0015 | PT-STN-03 × 80 @ 155.00 | 12,400.00 | 0/80 (GRN-0003 draft today) | Released, approved 22 Sep |
| PO-L-0877 | 18 Sep | S-0015 | VR-LAC-01 × 12 @ 95.00 | 1,254.00 | 12/12 | Done |
| PO-L-0870 | 15 Sep | S-0034 | FB-GRY-02 × 25 @ 40.00 | 1,100.00 | 25/25 | Done |
| PO-L-0861 | 10 Sep | S-0009 | HW-HNG-02 × 30 @ 21.60 (EXEMPT) | 648.00 | 20/30 | Partially received; balance being cancelled |

**Goods receipts**: GRN-0003 draft (29 Sep, PO-L-0879, DO CW-DO-2241) · GRN-0002 (26 Sep, PO-0002, MJP-DO-0930, Hafiz) · GRN-0001 (main case) · GRN-L-0410 (20 Sep, PO-L-0877, 12/12) · GRN-L-0406 (17 Sep, PO-L-0861, 20/30) · GRN-L-0398 (15 Sep, PO-L-0870, 25/25).

**Purchase invoices**: PI-0003 (29 Sep, TUE-INV-3310, PO-L-0870, 1,100.00, To match) · PI-0002 (28 Sep, MJP-INV-2291, PO-0002, 25,800.00 = price +3.2% because freight added; Pending approval with Ahmad Zaki) · PI-0001 (main case) · PI-L-0321 (22 Sep, HMK-INV-7702, PO-L-0861, 648.00, Rejected: billed 30 received 20) · PI-L-0318 (20 Sep, CW-INV-8812, PO-L-0877, 1,254.00, Approved).

**Cancel orders**: PCO-0001 (29 Sep, PO-L-0861, 10 of 30 hinge packs, 216.00, reason Supplier stopped the item, letter HMK-NOTICE-0926.pdf, Draft) · PCO-L-0012, L-0011, L-0010, L-0009 released (see `PoCancelList.html`).

**Cash purchases**: CP-0002 (29 Sep, S-0009, SC-WOD-08 × 12 @ 18.00 = 216.00 + 21.60 = 237.60, company card ···· 4471, receipt HMK-R-55120, Rahim, Draft) · CP-0001 (21 Sep, S-0070, cleaning supplies, 86.40, petty cash, Siti, Released) · CP-L-0098, L-0095, L-0091.

**Supplier debit notes**: PDN-0001 (29 Sep, S-0052, their note MJP-DN-0412, on PI-0002, SV-INS-01 × 1 LOT = 500.00 + SVC8 40.00 = 540.00, charge not on PO, Draft) · PDN-L-0021 (120.00), PDN-L-0019 (66.00).

**Purchase returns**: PRT-0001 (main case) · PRT-L-0017 (110.00, settled by credit note CW-CN-051) · PRT-L-0016 (176.00, settled by replacement).

**Approvals waiting for Ahmad Zaki**: PI-0002 (price difference) and PO-0003 (over limit). Decided in the last 7 days: PO-0002 approved 24 Sep, PI-L-0321 rejected 23 Sep, PO-L-0879 approved 22 Sep.
