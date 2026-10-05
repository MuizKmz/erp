# Seed data (Sales)

The demo data for the Sales module, taken from the Sales mockups (`docs/design/mockups/*.html`, S01–S33). After seeding, the screens must show these numbers. "Today" is the same as Purchase: **29 Sep 2026** (`DEV_TODAY`), business timezone Asia/Kuala_Lumpur.

Purchase seed data (`SEED_DATA.md`) stays as it is; nothing here may change a number on a Purchase screen. Where the mockups disagree with each other, the choice made is listed at the end under **Mockup conflicts**.

Rows marked *invented* are not in any mockup. They exist so that counts and totals add up.

## Master data (local `mdm_` tables, read only for Sales)

### New users (`mdm_user`)

| Code | Name | Email | Roles | Branches | Shown as |
|---|---|---|---|---|---|
| AR | Aina Rahman | aina@warehouse.com | SALES_AGENT, SALES_BILLING, SALES_STORE | HQ | Sales agent |
| LWJ | Lim Wei Jie | weijie@warehouse.com | SALES_AGENT, SALES_BILLING | PNG | Sales agent |
| FO | Faizal Omar | faizal@warehouse.com | SALES_AGENT, SALES_BILLING | HQ, PNG | Sales agent |
| NA | Nor Azlina | azlina@warehouse.com | SALES_MANAGER | HQ, PNG | Sales Manager |
| SC1 | Siti Counter 1 | counter1@warehouse.com | COUNTER_STAFF | HQ | Showroom counter |

Changes to existing users (roles added, nothing removed):
- RI Rosnah Ismail gets `FINANCE_MANAGER`, so she approves invoices for customers over their limit.
- RAH Rahim gets `SALES_STORE`. He is also the driver named on DO-0001 and DO-0003.
- ADM Admin gets every Sales permission. Most list mockups are signed in as admin@warehouse.com.

Aina covers selling, billing and delivery at HQ, as in the mockups. She creates and confirms DO-0001 and creates INV-0001, PF-0004, DN-0001 and SR-0001.

### Customers (new table `mdm_customer`)

| Code | Name | Category · area | Branch | Agent | Price list | Term | Credit limit | Overdue limit | Contact |
|---|---|---|---|---|---|---|---|---|---|
| C-0012 | Hotel Seri Bayu Sdn Bhd | Hospitality · Central | HQ | Aina Rahman | Standard 2026 | 30 days | 150,000.00 | 5,000.00 | Pn. Zarina Aziz · zarina@hotelseribayu.my |
| C-0031 | Kedai Perabot Maju | Reseller · Northern | PNG | Lim Wei Jie | Reseller 2026 | 30 days | 60,000.00 | 15,000.00 | Ms. Tan Mei Ling |
| C-0045 | Syarikat Delta Trading | Trading · Central | HQ | Faizal Omar | Standard 2026 | 30 days | 20,000.00 | 3,000.00 | En. Hafiz Karim |
| C-0056 *(code invented)* | Restoran Selera Kampung | Food and beverage · Northern | PNG | Faizal Omar | Standard 2026 | 30 days | 15,000.00 | 3,000.00 | Mr. Ravi Kumar |
| C-0078 | Klinik Sihat Jaya | Healthcare · Central | HQ | Faizal Omar | Standard 2026 | 30 days | 15,000.00 | 5,000.00 | Dr. Nurul Huda |
| C-0102 | Villa Damai Resort | Hospitality · Central | HQ | Aina Rahman | Standard 2026 | 30 days | 50,000.00 | 5,000.00 | Mr. Daniel Wong |
| C-CASH | Cash customer (walk-in) | — | HQ | — | Standard 2026 (tax inclusive) | Cash | none | none | — |

- All are `ACTIVE`, with TIN on file, except C-CASH, which has no TIN.
- Hotel Seri Bayu's address is Jalan Pantai Baharu, 59200 Kuala Lumpur.
- Hotel Seri Bayu's limit was RM 50,000.00 until 20 Sep, which is what SO-0001's credit snapshot shows. It was raised to RM 150,000.00 on 20 Sep, so SO-0003 passed its credit check on 27 Sep.
- Villa Damai Resort was a prospect on EQ-2609-0010 and was added to Master Data on 28 Sep.
- No customer has its own credit-scope override.

### Price lists (new tables `mdm_price_list`, `mdm_price_list_item`)

Prices exclude tax.

| Item | Name | Group | UOM | Tax | Standard 2026 | Reseller 2026 | Note |
|---|---|---|---|---|---|---|---|
| CH-DIN-01 | Dining chair, solid oak | Seating | PCS | SST10 | 250.00 | 235.00 | exists |
| CH-DIN-02 | Dining chair, walnut | Seating | PCS | SST10 | 280.00 | 265.00 | new |
| CH-BAR-01 | Bar stool, oak | Seating | PCS | SST10 | 190.00 | 180.00 | new |
| CH-OFF-02 | Office chair, mesh | Seating | PCS | SST10 | 300.00 | 285.00 | new |
| CH-DIN-09 | Dining chair, rattan | Seating | PCS | SST10 | 220.00 | 210.00 | new; excluded in both branches |
| CH-KID-01 | Kids chair, beech | Seating | PCS | SST10 | — | — | new; **not sellable** |
| TB-DIN-06 | Dining table, 6-seater | Tables | PCS | SST10 | 1,450.00 | 1,380.00 | exists |
| TB-RST-04 | Restaurant table, 4-seater | Tables | PCS | SST10 | 850.00 | — | new, *invented* |
| TB-COF-01 | Coffee table, teak | Tables | PCS | SST10 | 1,200.00 | — | new |
| TB-BED-01 | Bedside table | Tables | PCS | SST10 | 280.00 | — | new |
| TB-OUT-02 | Outdoor table, teak | Tables | PCS | SST10 | 1,600.00 | — | new |
| BD-KNG-01 | King bed frame, teak | Beds | PCS | SST10 | 1,400.00 | — | new |
| SF-CUS-03 | Custom 3-seater sofa, grey linen | Sofas | PCS | SST10 | 3,200.00 | — | exists; buy to order |
| SF-BTH-02 | Booth seat, 2-seater | Sofas | PCS | SST10 | 1,190.00 | — | new, *invented* |
| ST-BAR-02 | Bar stool, metal | Stools | PCS | SST10 | 100.00 | — | new |
| CB-SHO-01 | Shoe cabinet | Cabinets | PCS | SST10 | 350.00 | — | new |
| CU-SET-02 | Seat cushion set | Soft goods | SET | SST10 | 60.00 | — | new |
| SV-DEL-01 | Delivery trip, Klang Valley | Services | TRIP | SVC8 | 350.00 | — | new, service item |

- New sale items are sellable, not purchasable, and have no preferred supplier. They do not appear in Purchase demand because none has a reorder level.
- SF-CUS-03 moves from group Seating to Sofas, so the Seating filter in the item picker shows the 6 items in S04. No Purchase screen shows the item group.
- Cash sale prices are the Standard 2026 price including tax. For example, CH-DIN-01 is 275.00.
- "Last sold to this customer" comes from Sales invoice lines. INV-L-0419 on 12 Jul sold CH-DIN-01 to Kedai Perabot Maju at 240.00. CH-BAR-01 was sold to them at 185.00 on 3 May on INV-L-0350 *(number invented)*.

### Stock (`inv_stock_snapshot`, stub)

New rows:
- HQ-MAIN: BD-KNG-01 24.
- Penang main warehouse:
  - CH-DIN-02 48
  - CH-BAR-01 22
  - CH-OFF-02 0
  - CH-DIN-09 36
  - CH-KID-01 12

CH-DIN-01 stays at 0 everywhere; see conflict 9. SF-CUS-03 is buy to order and has 0 stock.

### Locations

A return location **Damaged goods · HQ Shah Alam** must exist under HQ-MAIN. Add it if `mdm_location` does not already have one.

## Sales settings

### Credit control (S29)

**Scope:** group-wide. It was per branch until an admin changed it on 20 Aug.

What happens on a breach, per document:

| Document | Over credit limit | Over overdue limit | Approver |
|---|---|---|---|
| Quotation | Allow, show warning | Allow, show warning | — |
| Sales order | Require approval | Require approval | Sales Manager |
| Delivery order | Allow, show warning | Require approval | Sales Manager |
| Invoice | Require approval | Require approval | Finance Manager |
| Cash sale | Allow | Allow, show warning | — |

Other rules:

| Rule | Value |
|---|---|
| Stock check while entering | Warn, never block |
| Invoice from delivered quantity only | On |
| Strict price list (price below list needs Sales Manager approval) | On |
| Round totals to 5 sen | On |
| Show estimated margin | **On**; see conflict 12 |
| Skip credit check for system-made documents | On; every skip is logged |
| Discount that needs Sales Manager approval | Above 15% on any line |
| Quotation expiry warning | 3 days before |

**Change history:**
- 15 Sep 2026 · admin · Invoice, over credit limit: Block → Require approval
- 2 Sep 2026 · Nor Azlina · Sales order approver set to Sales Manager
- 20 Aug 2026 · admin · Credit scope: Per branch → Group-wide

### Numbering (S30)

These are `sys_number_sequence` rows with module `sales`.

| Document | Format | Next number | Restart | Print template |
|---|---|---|---|---|
| Enquiry | EQ-{YYMM}-{####} | EQ-2609-0011 | Every month | Standard |
| Quotation | QT-{####} | QT-0013 | Never | With photos |
| Sales order | SO-{####} | SO-0009 | Never | Standard |
| Delivery order | DO-{####} | DO-0004 | Never | With signature box |
| Invoice | INV-{####} | INV-0004 | Never | Tax invoice |
| Cash sale | CS-{####} | CS-0005 | Never | Receipt 80 mm |
| Debit note | DN-{####} | DN-0002 | Never | Standard |
| Sales return | SR-{####} | **SR-0003**; see conflict 11 | Never | Credit note |
| Proforma invoice | PF-{####} | PF-0005 | Never | Proforma |
| Cancel order | CO-{####} | CO-0003 | Never | Standard |

- "Separate per branch" is shown as Yes for DO and CS, but in this phase it is display only and every document type has one sequence.
- **Sales order types:** Standard (default, ship from stock), Buy to order (Purchase drafts a PO when released), Project (linked to a project for reporting). All are active.

### Enquiry types and sources (S31)

**Types**, with the extra details each one asks for:
- Furniture bulk: quantity range, delivery city.
- Custom order: Dimensions (W × D × H) text, required; Material choice, required; Finish choice, optional; Drawings file, optional. Default agent is round-robin.
- Reseller: company registration, showrooms.
- Office furniture: number of staff, floor plan.
- Hospitality project: rooms, opening date.
- Spare parts: original invoice number. **Inactive.**

**Sources:** Phone, Email, Website, Walk-in, Referral.

The September counts come from the 24 enquiries below:
- By type: Furniture bulk 9, Custom order 6, Reseller 4, Office furniture 3, Hospitality project 2.
- By source: Phone 7, Email 6, Website 5, Walk-in 4, Referral 2.
- Became quotations: Phone 5, Email 4, Website 2, Walk-in 1, Referral 0.

### Excluded items (S32)

**Active:**

| Item | Branch | Reason | From | Until | Added by |
|---|---|---|---|---|---|
| CH-DIN-09 | Penang Branch | Supplier recall | 15 Sep 2026 | until removed | Nor Azlina |
| CH-DIN-09 | HQ Shah Alam | Supplier recall | 15 Sep 2026 | until removed | Nor Azlina |
| SF-CUS-03 | Penang Branch | Not offered in branch | 1 Jul 2026 | until removed | admin |
| TB-OUT-02 | HQ Shah Alam | Seasonal | 1 Nov 2026 | 28 Feb 2027 | Aina Rahman |
| CU-SET-02 | Penang Branch | Pricing under review | 20 Sep 2026 | 20 Oct 2026 | Lim Wei Jie |

Two more exclusions ended earlier this year *(invented)*.

### Email templates (S33)

There are six templates:

| Template | Sent from |
|---|---|
| Quotation | quotations |
| Order confirmation | sales orders |
| Invoice | invoices |
| Proforma · deposit request | proformas |
| Delivery notice | when a DO is confirmed |
| Overdue reminder | manually, from an invoice |

**Fields you can use:** `{contact.name}` `{document.number}` `{document.total}` `{document.due_date}` `{document.customer_ref}` `{agent.name}` `{agent.phone}` `{company.name}`.

The Invoice template, exactly:
- **Subject:** `Invoice {document.number} from {company.name}`
- **Message:**

  > Dear {contact.name},
  > Please find attached invoice {document.number} for {document.total}, due on {document.due_date}.
  > Your reference: {document.customer_ref}
  > If you have any questions, reply to this email or contact {agent.name} at {agent.phone}.
  > Thank you,
  > {company.name}

- **Switches:** attach PDF on, copy the sales agent on.
- **Preview:** for INV-0001 it goes to zarina@hotelseribayu.my, with Cc aina@warehouse.com.

## The main case: SO-0001 (follow it through every screen)

| Doc | Date | What | Status |
|---|---|---|---|
| EQ-2609-0006 | 18 Sep | Hotel Seri Bayu, Pn. Zarina Aziz, Furniture bulk from Email, Aina, HQ, budget 30,000.00 | Quoted |
| QT-0001 | 18 Sep | 100 × CH-DIN-01 @ 250.00, SST 10%, total 27,500.00, valid until 2 Oct | Ordered → SO-0001 |
| SO-0001 | 18 Sep | Customer PO HSB-PO-2231, project "Renovation Wing B", delivery wanted by 12 Oct, promised 5 Oct, delivery address Jalan Pantai Baharu, 59200 Kuala Lumpur | Partial · 60 of 100 delivered |
| DO-0001 | 21 Sep | 60 delivered, vehicle VKL 3321 · Rahim, CN-778120, receiver Pn. Zarina Aziz, loading bay B note | Delivered (confirmed) |
| INV-0001 | 21 Sep | 60 × 250.00, subtotal 15,000.00, tax 1,500.00, total 16,500.00, due 21 Oct | Released · Unpaid · credited |
| SR-0001 | 24 Sep | 5 × CH-DIN-01 back, Damaged in transit, to Damaged goods · HQ, credit note to customer account, ref HSB-RMA-014, 2 photos; credit 1,250.00 + 125.00 = 1,375.00 | Released |
| DN-0001 | 29 Sep | Adds to INV-0001: 1 × SV-DEL-01 @ 350.00 (SVC8), "Second delivery trip requested by customer on 27 Sep 2026", reason Extra service requested, due 21 Oct | Draft |

- **SO-0001 lines:** CH-DIN-01, ordered 100, delivered 60, invoiced 60, balance 40, price 250.00, amount 25,000.00. Totals: subtotal 25,000.00, discount 0.00, tax 2,500.00, rounding 0.00, total 27,500.00.
- **SO-0001 credit snapshot at save:** passed. Owed before 12,000.00, this order 27,500.00, limit 50,000.00, headroom 10,500.00, group-wide, overdue 0.00 of a 5,000.00 limit.
- **SO-0001 activity:**
  - 18 Sep 10:05 Created from QT-0001
  - 10:06 Credit check passed
  - 10:12 Released by Aina Rahman · sales.order.released saved
  - 21 Sep 9:30 DO-0001 confirmed: 60 delivered, balance 40
  - 21 Sep 2:02 PM INV-0001 released: 60 invoiced, RM 16,500.00
- **SO-0001 release warning:** 60 in stock, 40 short. Warned, not blocked.
- **INV-0001 balance:** 16,500.00 − 1,375.00 credited (SR-0001) − 0 paid = **15,125.00**.
- **INV-0001 activity:**
  - 21 Sep 1:58 PM created from SO-0001
  - 2:02 PM released · posting and e-Invoice queued
  - 2:05 PM emailed to zarina@hotelseribayu.my
  - 24 Sep 11:42 AM SR-0001 released: credit RM 1,375.00
- **DN-0001 effect:** tax 28.00, debit total 378.00, so INV-0001 is due 15,503.00 after release.
- **Waiting for other modules, on the SO-0001 document flow:**
  - Finance postings queued 2 (INV-0001, SR-0001)
  - e-Invoice pending 2 (INV-0001, SR-0001)
  - Inventory events saved 2 (DO-0001 shipment, SR-0001 stock in)

## Other Sales documents

### Enquiries (S06): 24 in September

- **Counts:** New 6, Forwarded 4, Quoted 11, Lost 3.
- **Numbering:** ten use the new series EQ-2609-0001…0010. The other 14 are migrated `EQ-L-…` rows, also dated September *(invented)*, which make the totals in S31 work.

| Enq | Date | Customer · contact | Status | Agent | Type · from | Branch | Budget | Quotation |
|---|---|---|---|---|---|---|---|---|
| EQ-2609-0010 | 27 Sep | Villa Damai Resort (prospect then) · Mr. Daniel Wong | New | Aina Rahman | Custom order · Referral | HQ | 80,000.00 | — |
| EQ-2609-0009 | 25 Sep | Kedai Perabot Maju · Ms. Tan Mei Ling | Quoted | Lim Wei Jie | Reseller · Website | PNG | 95,000.00 | QT-0012 |
| EQ-2609-0008 | 24 Sep | Restoran Selera Kampung · Mr. Ravi Kumar | Forwarded | Faizal Omar | Custom order · Walk-in | PNG | 12,000.00 | — |
| EQ-2609-0007 | 19 Sep | Syarikat Delta Trading · En. Hafiz Karim | Quoted | Faizal Omar | Furniture bulk · Phone | HQ | 5,000.00 | QT-0009 |
| EQ-2609-0006 | 18 Sep | Hotel Seri Bayu · Pn. Zarina Aziz | Quoted | Aina Rahman | Furniture bulk · Email | HQ | 30,000.00 | QT-0001 |
| EQ-2609-0004 | 10 Sep | Klinik Sihat Jaya · Dr. Nurul Huda | Lost | Faizal Omar | Office furniture · Phone | HQ | 8,500.00 | QT-0005 |

- **EQ-2609-0009 description:** "Restocking two showrooms in Penang. Wants 200 oak dining chairs and 30 six-seater tables, delivered in one lot. Asked about reseller pricing."
- **EQ-2609-0009 items of interest:** CH-DIN-01 × 200 (Natural finish) and TB-DIN-06 × 30 (Same finish as chairs).
- **S07 "New enquiry" form defaults:** Kedai Perabot Maju, Penang Branch, Reseller, Website, Lim Wei Jie, with the same items. It shows "Number EQ-2609-0011 is assigned on save". This is a new, unsaved enquiry; the seed only has to make the number come out right.

### Quotations (S08): 14

- **Counts:** Draft 4, Released 2, Turned into order 5, Expired 1, Lost 2.
- **"Released" tab:** shows 7, because it counts released and turned-into-order together; see conflict 5.

| QT | Rev | Date | Valid until | Customer | Agent | Total | Sales order | Status |
|---|---|---|---|---|---|---|---|---|
| QT-0012 | 0 | 29 Sep | 13 Oct | Kedai Perabot Maju | Lim Wei Jie | 92,378.00 | — | Draft |
| QT-0011 | 0 | 28 Sep | 12 Oct | Villa Damai Resort | Aina Rahman | 36,960.00 | SO-0007 | Ordered |
| QT-0010 | 1 | 25 Sep | 9 Oct | Restoran Selera Kampung | Faizal Omar | 12,540.00 | — | Released · rev 1 |
| QT-0009 | 0 | 19 Sep | 3 Oct | Syarikat Delta Trading | Faizal Omar | 4,400.00 | SO-0002 | Ordered |
| QT-0008 | 0 | 24 Sep | 8 Oct | Hotel Seri Bayu | Aina Rahman | 70,400.00 | SO-0003 | Ordered |
| QT-0001 | 0 | 18 Sep | 2 Oct | Hotel Seri Bayu | Aina Rahman | 27,500.00 | SO-0001 | Ordered |
| QT-0005 | 0 | 10 Sep | 24 Sep | Klinik Sihat Jaya | Faizal Omar | 8,580.00 | — | Expired |
| QT-0003 *(invented)* | 0 | 21 Sep | 5 Oct | Restoran Selera Kampung | Faizal Omar | 13,090.00 | SO-0004 | Ordered |
| QT-0004 *(invented)* | 0 | 18 Sep | **2 Oct** | Klinik Sihat Jaya | Faizal Omar | 3,300.00 | — | Released |
| QT-0002, QT-0006, QT-0007 *(invented)* | 0 | Sep | — | any | any | any | — | Draft |
| QT-L-0099, QT-L-0101 *(invented)* | 0 | Sep | — | any | any | any | — | Lost (reason given) |

**QT-0012** (S09, from EQ-2609-0009):
- **Header:** contact Ms. Tan Mei Ling, 29 Sep, valid until 13 Oct, Lim Wei Jie, Penang Branch, MYR, Exclusive, 30 days, price list Reseller 2026.
- **Lines:**
  1. CH-DIN-01 × 200 @ 235.00, disc 5% → 44,650.00
  2. TB-DIN-06 × 30 @ 1,380.00, disc 5% → 39,330.00
- **Totals:** subtotal 88,400.00, discount −4,420.00, tax 8,398.00, rounding 0.00, total **92,378.00**. Estimated margin 28.6%, which only the Sales Manager sees.
- **Credit banner:** "Over credit limit by RM 50,778.00. Owed RM 18,400.00 + this quotation RM 92,378.00 against a RM 60,000.00 limit. Quotations are allowed; the sales order will need approval."
- **Customer-facing note:** "Prices valid for 14 days. Delivery within 3 weeks of order confirmation, one lot to Penang."
- **Attachments:** 1.

**QT-0010:** rev 1 after Nor Azlina approved an 18% discount on 28 Sep. Net 11,400.00 after the discount, tax 1,140.00, total 12,540.00 (lines *invented*). The expired QT-0005 is 26 × CH-OFF-02 @ 300.00 = 7,800.00 + tax = 8,580.00.

### Sales orders (S10): 18

The 18 orders are the 8 new ones below plus 10 migrated `SO-L-…` orders, all closed before September: 9 Done and 1 Cancelled *(invented)*. They include SO-L-0981, SO-L-0952 and SO-L-0930, which the cancellations use.

| SO | Date | Customer | Agent | Branch | Lines | Total | Delivered | Invoiced | Status | Credit |
|---|---|---|---|---|---|---|---|---|---|---|
| SO-0008 | 28 Sep | Kedai Perabot Maju | Lim Wei Jie | PNG | as QT-0012 | 92,378.00 | 0 / 230 | 0.00 | Pending approval | Over limit |
| SO-0007 | 28 Sep | Villa Damai Resort | Aina Rahman | HQ | 24 × BD-KNG-01 @ 1,400.00 | 36,960.00 | 0 / 24 | 0.00 | Released | OK |
| SO-0001 | 18 Sep | Hotel Seri Bayu | Aina Rahman | HQ | main case | 27,500.00 | 60 / 100 | 16,500.00 | Partial | OK |
| SO-0002 | 26 Sep | Syarikat Delta Trading | Faizal Omar | HQ | 16 × CH-DIN-01 @ 250.00 | 4,400.00 | 0 / 16 | 0.00 | Pending approval | Over limit |
| SO-0003 | 27 Sep | Hotel Seri Bayu · **Buy to order** | Aina Rahman | HQ | 20 × SF-CUS-03 @ 3,200.00 | 70,400.00 | 0 / 20 | 0.00 | Released | OK |
| SO-0004 | 22 Sep | Restoran Selera Kampung | Faizal Omar | PNG | 7 × TB-RST-04 @ 850.00 + 5 × SF-BTH-02 @ 1,190.00 | 13,090.00 | 12 / 12 | 13,090.00 | Done | OK |
| SO-0005 | 23 Sep | Kedai Perabot Maju | Lim Wei Jie | PNG | 80 × CH-DIN-01 @ 240.00 | 21,120.00 | 0 / 80 | 0.00 | Draft | Checked on save |
| SO-0006 | 12 Sep | Klinik Sihat Jaya | Faizal Omar | HQ | 25 × CH-OFF-02 @ 300.00 | 8,250.00 | 10 / 25 | 3,300.00 | Partial; see conflict 2 | OK |

- **SO-0007:** wanted by 15 Oct, promised 20 Oct, from QT-0011.
- **SO-0003:** wanted by 30 Oct, promised 12 Oct. Its line is linked to **PO-0003** from the Purchase seed, and PO-0003 is pending approval.
- **SO-0004:** delivered by DO-0002 and invoiced by INV-0002. QT-0003 is the source.
- **SO-0006:** its 10 delivered and invoiced chairs went through the old system during the parallel run, on DO-L-0388 and INV-L-0405 *(invented)*.
- **SO-0002 credit request:** made 26 Sep 3:14 PM by Faizal. The check table:

  | Check | Limit | Now | This order | After | Result |
  |---|---|---|---|---|---|
  | Credit limit | 20,000.00 | 18,000.00 | 4,400.00 | 22,400.00 | over by 2,400.00 |
  | Overdue limit | 3,000.00 | 5,000.00 | — | 5,000.00 | over by 2,000.00 |

  Reason: "Long-standing customer. They promised RM 5,000.00 by cheque on 2 Oct." Approver: Nor Azlina.
- **SO-0008 credit request:** made 28 Sep 11:20 AM by Lim Wei Jie. Over the credit limit by 50,778.00. It is from enquiry EQ-2609-0009; see conflict 4.

**Sales by agent, September** (S01, S05):
- Aina Rahman: 3 orders, 134,860.00
- Lim Wei Jie: 2 orders, 113,498.00
- Faizal Omar: 3 orders, 25,740.00
- Total: 274,098.00 ordered, 32,890.00 invoiced

### Delivery orders (S15)

| DO | Date | Customer | From | Qty | Vehicle · driver | CN | Status |
|---|---|---|---|---|---|---|---|
| DO-0003 | 29 Sep | Villa Damai Resort | SO-0007 | 24 | VKL 3321 · Rahim | — | Draft |
| DO-0002 | 22 Sep | Restoran Selera Kampung | SO-0004 | 12 | PKN 882 · Suresh | CN-778431 | Delivered |
| DO-0001 | 21 Sep | Hotel Seri Bayu | SO-0001 | 60 | VKL 3321 · Rahim | CN-778120 | Delivered |

**KPIs:**
- Orders waiting to be delivered: 3, 84 units (SO-0001 40, SO-0007 24, SO-0003 20).
- Due in the next 14 days: 2 (SO-0001, SO-0007).
- Draft DOs: 1 (DO-0003).
- Delivered this month: 72 units on 2 DOs. Migrated DOs are not counted.

**Waiting list rows:**
- SO-0001: 0 in stock → "Waiting for stock"
- SO-0007: 24 in stock → "Create DO"
- SO-0003: buy to order → "Waiting for purchase"

SO-0006 is not listed because CO-0002 is cancelling its whole balance.

### Invoices (S17): 31

- **Counts:** Draft 1, Unpaid 14 (of which Overdue 6), Paid 16.
- **KPIs:** balance due RM 84,640.00 on 14 unpaid invoices. Overdue RM 36,900.00 across 5 customers. Waiting for Finance: 3 postings. LHDN e-Invoice pending: 3 (INV-0001, INV-0002, SR-0001).
- **Overdue** means the due date is before 29 Sep and the balance is above 0.

| Invoice | Date | Customer | Total | Balance due | Due | State | Note |
|---|---|---|---|---|---|---|---|
| INV-0003 (direct) | 29 Sep | Klinik Sihat Jaya | 2,904.00 | 2,904.00 | — | Draft · waiting approval | 10 × CH-OFF-02 @ 264.00 (12% below 300.00); price approval asked by Faizal 29 Sep 9:05 AM |
| INV-0002 (SO-0004, DO-0002) | 22 Sep | Restoran Selera Kampung | 13,090.00 | **6,545.00**; see conflict 3 | 22 Oct | Unpaid | deposit PF-0001 6,545.00 used |
| INV-0001 (SO-0001, DO-0001) | 21 Sep | Hotel Seri Bayu | 16,500.00 | 15,125.00 | 21 Oct | Unpaid · credited | main case |
| INV-L-0389 | 29 Aug | Hotel Seri Bayu | 12,000.00 | 12,000.00 | 28 Sep | Overdue 1 day | *invented* |
| INV-L-0376 | 18 Jun | Syarikat Delta Trading | 8,000.00 | 5,000.00 | 18 Jul | Overdue 73 days | |
| INV-L-0424 | 1 Sep | Syarikat Delta Trading | 6,500.00 | 6,500.00 | 1 Oct | Unpaid | *invented* |
| INV-L-0427 | 10 Sep | Syarikat Delta Trading | 6,500.00 | 6,500.00 | 10 Oct | Unpaid | *invented* |
| INV-L-0398 | 12 Aug | Kedai Perabot Maju | 6,400.00 | 6,400.00 | 11 Sep | Overdue | DN-L-0033 is on it |
| INV-L-0402 | 20 Aug | Kedai Perabot Maju | 5,600.00 | 5,600.00 | 19 Sep | Overdue | *invented* |
| INV-L-0431 | 15 Sep | Kedai Perabot Maju | 6,400.00 | 6,400.00 | 15 Oct | Unpaid | *invented* |
| INV-L-0393 | 16 Aug | Klinik Sihat Jaya | 4,500.00 | 4,500.00 | 15 Sep | Overdue | *invented* |
| INV-L-0405 | 14 Sep | Klinik Sihat Jaya | 3,300.00 | 3,300.00 | 14 Oct | Unpaid | SO-0006's 10 chairs |
| INV-L-0436 | 20 Sep | Klinik Sihat Jaya | 1,500.00 | 1,500.00 | 20 Oct | Unpaid | *invented* |
| INV-L-0385 | 26 Aug | Restoran Selera Kampung | 3,400.00 | 3,400.00 | 25 Sep | Overdue | *invented* |
| INV-L-0433 | 18 Sep | Restoran Selera Kampung | 1,870.00 | 1,870.00 | 18 Oct | Unpaid | *invented* |
| INV-L-0412 | 5 Aug | Syarikat Delta Trading | 6,200.00 | 0.00 | 4 Sep | Paid | |
| INV-L-0355 | 12 Aug | Hotel Seri Bayu | 8,800.00 | 0.00 | 11 Sep | Paid | |
| INV-L-0388 | Jul | Syarikat Delta Trading | 4,800.00 | 0.00 | — | Paid on time | |
| INV-L-0301 | 3 Jul | Hotel Seri Bayu | 14,300.00 | 0.00 | — | Paid | |
| INV-L-0419 | 12 Jul | Kedai Perabot Maju | any | 0.00 | — | Paid | has CH-DIN-01 @ 240.00 |
| 11 more `INV-L-…` | before Sep | any | any | 0.00 | — | Paid | *invented* |

**What customers owe now:**

| Customer | Owed | Overdue |
|---|---|---|
| Hotel Seri Bayu | 27,125.00 | 12,000.00 |
| Kedai Perabot Maju | 18,400.00 | 12,000.00 |
| Syarikat Delta Trading | 18,000.00 | 5,000.00 (over 60 days: 5,000.00) |
| Klinik Sihat Jaya | 9,300.00 | 4,500.00 |
| Restoran Selera Kampung | 11,815.00 | 3,400.00 |
| Villa Damai Resort | 0.00 | 0.00 |

**Payments** come from a read-only stub `fin_receipt_stub` until Finance is connected. It holds the receipts for the paid migrated invoices, the partial 3,000.00 on INV-L-0376, the deposits on PF-0001 and PF-0003, and Delta's last payment of RM 3,500.00 on 2 Sep 2026.

### Proformas (S21)

| PF | Date | Customer | SO | Request | Amount | Received | Status |
|---|---|---|---|---|---|---|---|
| PF-0004 | 29 Sep | Villa Damai Resort | SO-0007 | Deposit 30%, pay by 5 Oct | 11,088.00 | — | Draft |
| PF-0003 | 27 Sep | Hotel Seri Bayu | SO-0003 | Deposit 30% | 21,120.00 | 21,120.00 | Paid |
| PF-0002 | 26 Sep | Syarikat Delta Trading | SO-0002 | Pay before release | 4,400.00 | — | Sent |
| PF-0001 | 22 Sep | Restoran Selera Kampung | SO-0004 | Deposit 50% | 6,545.00 | 6,545.00 | Used on INV-0002 (22 Sep) |

- **KPIs:** requested 43,153.00 on 4 proformas, received 27,665.00 on 2, waiting 15,488.00.
- **PF-0004:** attention Mr. Daniel Wong, Aina Rahman. Line: 24 × BD-KNG-01 @ 1,400.00. Subtotal 33,600.00, tax 3,360.00, order total 36,960.00, deposit 11,088.00. Note: "Delivery is scheduled once the deposit is received."

### Cancel orders (S13)

| CO | Date | SO | Customer | What | Value | Reason | Status |
|---|---|---|---|---|---|---|---|
| CO-0002 | 29 Sep | SO-0006 | Klinik Sihat Jaya | 15 of 25 office chairs | 4,950.00 | Customer changed requirement | Draft |
| CO-0001 | 16 Sep | SO-L-0981 | Restoran Selera Kampung | 4 dining chairs | 1,100.00 | Item discontinued | Released |
| CO-L-0044 | 2 Sep | SO-L-0952 | Kedai Perabot Maju | Whole order · 12 stools | 1,320.00 | Cancelled before delivery | Released |
| CO-L-0041 | 20 Aug | SO-L-0930 | Syarikat Delta Trading | 6 of 30 tables | 2,640.00 | Out of stock, customer agreed | Released |

- **Footer:** 4 cancellations · RM 10,010.00 since August.
- **CO-0002 (S14):** asked by Dr. Nurul Huda, reference "Email, 28 Sep 2026". Note: "Clinic renovation reduced to one floor. Keep the 10 chairs already delivered." Line: CH-OFF-02 ordered 25, delivered 10, invoiced 10, balance 15, cancel now 15, left after 0.

**Open balances list:**

| Order | Open | Promised | Waiting for | Action |
|---|---|---|---|---|
| SO-0001 | 40 chairs | 5 Oct | Stock · PO-0001 fabric | Cancel balance |
| SO-0003 | 20 sofas | 12 Oct | Buy to order · PO-0003 | Linked to a PO |
| SO-0007 | 24 beds | 20 Oct | Deposit · PF-0004 | Cancel balance |

### Cash sales (S23): 38 in September

- **Counts:** Draft 1, Released 37.
- **Numbering:** 4 use the new series. The other 34 are migrated `CS-L-…` rows from September; the 32 not listed below are *invented*, with a total of 13,959.00, roughly card 7,022.00, DuitNow 4,160.00 and cash 2,777.00.

| CS | Date | Buyer | What | Paid by | Total | e-Invoice | Status |
|---|---|---|---|---|---|---|---|
| CS-0004 | 29 Sep | Walk-in (Encik Amir, +60 12-448 1200) | 2 × CH-DIN-01 @ 275.00 incl. | Card · Terminal 2 · approval 448120 | 550.00 | Consolidated | Draft |
| CS-0003 | 28 Sep | Encik Faizal Hakim (TIN given) | 1 × TB-COF-01 | DuitNow QR | 1,320.00 | Own e-Invoice · pending | Released |
| CS-0002 | 27 Sep | Walk-in | 4 × ST-BAR-02 | Cash | 440.00 | Consolidated | Released |
| CS-0001 | 26 Sep | Walk-in | 2 × TB-BED-01 | Card | 616.00 | Consolidated | Released |
| CS-L-0231 | 24 Sep | Walk-in | 6 × CH-DIN-01 | Card | 1,650.00 | Old system | Released |
| CS-L-0230 | 24 Sep | Puan Rohani | 1 × CB-SHO-01 | DuitNow QR | 385.00 | Old system | Released |

- **KPIs:**
  - Today at the counter: RM 550.00, 1 sale.
  - September: RM 18,920.00 on 38 cash sales.
  - Paid by: card 52%, DuitNow 31%, cash 17%.
  - Consolidated e-Invoice: 37 sales, due 7 Oct.
- **CS-0004:** customer C-CASH, served by Siti Counter 1. Totals: before tax 500.00, tax included 50.00, to pay 550.00, paid 550.00, change 0.00.

### Debit notes (S25)

| DN | Date | Customer | Invoice | Reason | Amount | Status |
|---|---|---|---|---|---|---|
| DN-0001 | 29 Sep | Hotel Seri Bayu | INV-0001 | Extra delivery trip, Klang Valley | 350.00 + tax | Draft |
| DN-L-0033 | 10 Sep | Kedai Perabot Maju | INV-L-0398 | Price under-billed on 6 tables | 180.00 | Released |
| DN-L-0029 | 28 Aug | Syarikat Delta Trading | INV-L-0376 | Rush delivery charge | 250.00 | Released |

The two migrated debit notes are already included in their invoices' balances.

### Sales returns (S27)

| SR | Date | Customer | Invoice | What | Reason | Went to | Credit | Status |
|---|---|---|---|---|---|---|---|---|
| SR-0002 | 29 Sep | Restoran Selera Kampung | INV-0002 | 1 × TB-RST-04 | Scratched top | Damaged goods | 935.00 | Draft |
| SR-0001 | 24 Sep | Hotel Seri Bayu | INV-0001 | 5 × CH-DIN-01 | Damaged in transit | Damaged goods | 1,375.00 | Released |
| SR-L-0019 | 5 Sep | Syarikat Delta Trading | INV-L-0412 | 2 × CH-OFF-02 @ 270.00 | Wrong colour | Back to stock | 594.00 | Released |

**KPIs:**
- Credited this month: RM 1,969.00 on 2 returns.
- Draft: 1.
- Top reason: Damaged in transit, 5 of 8 units.
- Credit notes for LHDN: 1 queued.
- Where goods went: Damaged goods · HQ 6 units, back to stock 2 units.

### Approvals (S02, signed in as Nor Azlina)

**Waiting:**
- SO-0002, credit
- SO-0008, credit
- INV-0003, price: "Unit price 12% below the price list on 1 line"

**Approved · 12, Rejected · 2.** The last 7 days:

| Document | Reason | Decision | Date |
|---|---|---|---|
| QT-0010 | Discount 18%, above 15% rule | Approved | 28 Sep |
| SO-0006 | Overdue limit, Klinik Sihat Jaya | Approved | 25 Sep |
| INV-L-0398 | Price 20% below price list | Rejected | 24 Sep |
| SO-0004 | Credit limit, Restoran Selera Kampung | Approved | 22 Sep |

The other 9 approvals and 1 rejection are older *(invented)*. Delta's last credit approval was on 12 Aug 2026.

The SO-0002 panel shows:
- Owed now 18,000.00, of which over 60 days 5,000.00.
- Other open orders 0.00, this order 4,400.00, exposure after 22,400.00, limit 20,000.00.
- Last payment RM 3,500.00 on 2 Sep 2026.
- History: INV-L-0412 6,200.00 paid on time (see conflict 10); INV-L-0388 4,800.00 paid on time.

### Outbox (events already saved, waiting for modules not connected)

| Event | Document |
|---|---|
| `sales.order.released` | SO-0001, SO-0003, SO-0004, SO-0007 |
| `sales.shipment.requested` | DO-0001, DO-0002 |
| `sales.invoice.released` | INV-0001, INV-0002 |
| `sales.return.released` | SR-0001 |
| `sales.cash_sale.released` | CS-0001, CS-0002, CS-0003 |

All are PENDING.

## Mockup conflicts (choice made; please confirm)

| # | Where | Conflict | Choice |
|---|---|---|---|
| 1 | S01 home | The KPI cards ("Open sales orders 18 · RM 212,400.00" …) don't match the other screens. The mockup labels them *Sample data*. | Calculate them live from the data. |
| 2 | S10, S05 vs S13, S14 | The order list and report treat CO-0002 as released (SO-0006 "Balance cancelled", RM 4,950.00 cancelled). The cancel screens show CO-0002 as Draft. | CO-0002 is **Draft**, so you can test releasing it. Until then SO-0006 shows Partial. After release, S10 and S05 match their mockups. |
| 3 | S17 vs S21 and flow F4 | INV-0002 shows a balance of 13,090.00, but PF-0001's 6,545.00 deposit was "used on INV-0002", and F4 says balance = total − deposit. | Balance **6,545.00**, following the rule. |
| 4 | S08, S09 vs S02, S10 | QT-0012 is a Draft dated 29 Sep, but SO-0008 (28 Sep) is said to come "from quotation QT-0012". | QT-0012 stays **Draft**, as S09 and the item picker show it. SO-0008's source is enquiry EQ-2609-0009. |
| 5 | S08 tabs | Draft 4 + Released 7 + Ordered 5 + Expired 1 adds up to more than All 14. | "Released" counts released and turned into order. The other 2 quotations are Lost. |
| 6 | S08 banner | It warns that QT-0001 and QT-0009 expire soon, but both are already turned into orders. | Warn only on open released quotations: QT-0004 (2 Oct). |
| 7 | S10 tabs | Draft 3 / Pending 1 can't hold with the 8 orders shown (two are Pending). | Counts come from the data: Draft 1, Pending 2, Released 2, Partial 2, Done 10, Cancelled 1. |
| 8 | S06, S31 | 24 September enquiries, but the next number is EQ-2609-0011. | 10 new and 14 migrated `EQ-L-…` in September. |
| 9 | S04 | The item picker shows CH-DIN-01 with 164 in stock at Penang. Seeding that would change the Purchase demand list (P04). | Purchase numbers win. Penang stock for CH-DIN-01 stays 0. |
| 10 | S02 | "Last payment 2 Sep" disagrees with INV-L-0412 "paid 12 days late" (due 4 Sep). | Keep the last payment on 2 Sep. INV-L-0412 shows as paid on time. |
| 11 | S30 | The next return number is SR-0002, but SR-0002 already exists. | Next is **SR-0003**. |
| 12 | S29 vs S09 | "Show estimated margin" is off, yet the quotation shows the margin to the manager. | Switch **on**, so the S09 margin line shows to the Sales Manager. |
| 13 | Sidebar | "Draft Quotation" is in the menu but has no screen in SCREENS.md. | It opens the quotation list on the Draft tab. |
