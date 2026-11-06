# WMS data ownership

The agreement between the ERP and a client's WMS, confirmed by the user on 6 Nov 2026. Both systems have similar screens. For each kind of data, one system is the **system of record**: it creates and edits the data, and the other system only reads it.

**The rule:** paperwork and money belong to the ERP. Physical goods belong to the WMS.

## Data ownership matrix

| Data | System of record | The other system |
|---|---|---|
| Items | ERP Core | WMS receives them, then adds its own weight, size and image |
| Suppliers, customers, categories | ERP Core | WMS receives them, read only |
| Warehouses | ERP Core | WMS receives them, then adds its own address and manager |
| Prices, tax, credit | ERP | WMS does not need them |
| Purchase orders, sales orders, delivery orders | ERP | WMS receives them as work to do |
| Locations and racks | WMS | ERP reads them |
| RFID tags (EPCs) and stock quantity | WMS | ERP reads them |
| Receiving, picking and shipping scans | WMS | ERP gets the result |
| Stock takes, adjustments and movements | WMS | ERP sees the new stock |

The ERP never generates tags, prints stickers or changes a tag's status.

## Stages

**Stage 1, before cutover: read only.** Nothing syncs automatically.
- The WMS keeps working as it does today.
- An initial data load copies its master data into the ERP, keeping the codes. It can be run again.
- The ERP's WMS module reads live data from the WMS and stores none of it. A SKU the ERP does not know shows as "Not in ERP".

**Stage 2, after cutover: integration events.** Cutover is the date the ERP becomes the master. From then on the WMS's supplier, customer, category, product and order screens are view only for that client.

| When this happens | Where | What happens next |
|---|---|---|
| Item, supplier or customer saved | ERP Core | WMS gets the update (master data sync) |
| PO released | ERP | WMS gets it as expected goods |
| Goods received and scanned | WMS | ERP creates the GRN |
| Delivery order sent | ERP | WMS gets it as work to pick |
| Shipment marked shipped | WMS | ERP confirms the delivery |
| Rack added, or stock adjusted | WMS | ERP shows the new figures |

**Not built yet for stage 2:** the ERP records its events but delivers none to a WMS, and the WMS sends none. A GRN made by the WMS must not send a stock-in back to it, or the goods count twice (`EVENTS.md`).

## Terms

| Term | Meaning |
|---|---|
| System of record, or master | The one system allowed to create and edit that data |
| Initial data load | The one-time copy at the start |
| Master data sync | Changes in the owner reach the other system |
| Integration events | One system tells the other that something happened |
| Cutover | The day the ERP takes over as master |
| Read-only view | Data you can see but not edit |
