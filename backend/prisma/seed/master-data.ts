/**
 * Master data (mdm_) and the inv_/sal_ stubs, from docs/design/SEED_DATA.md.
 * Upserted on business codes so ids stay stable between runs.
 *
 * Not in SEED_DATA.md, filled in for the mockups to work (marked "invented" below):
 * supplier e-mails other than the two given, item groups, pack sizes, usage in the last 30 days,
 * the 9 extra items for things the mockups buy that were not in the item list, and sales-order totals.
 */
import { MdmItemType, Prisma } from '@prisma/client';
import { day, kl, type SeedCtx } from './util';

const BRANCHES = [
  { code: 'HQ', name: 'HQ Shah Alam' },
  { code: 'PNG', name: 'Penang Branch' },
];

// Branch assignments are not in SEED_DATA.md: Penang manager → PNG only, requesters → HQ, the rest → both.
// Job titles follow the mockups: "Rahim · Store", "Siti · Admin"; Nurul and Hafiz show only their department.
const USERS: { code: string; name: string; email: string; roles: string[]; branchCodes: string[]; department?: string; jobTitle?: string }[] = [
  { code: 'LMY', name: 'Lim Mei Ying', email: 'meiying@warehouse.com', roles: ['PURCHASE_BUYER', 'AP_CLERK'], branchCodes: ['HQ', 'PNG'], department: 'Purchasing', jobTitle: 'Buyer' },
  { code: 'AZ', name: 'Ahmad Zaki', email: 'zaki@warehouse.com', roles: ['PURCHASE_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Purchasing', jobTitle: 'Purchasing Manager' },
  { code: 'TWL', name: 'Tan Wei Ling', email: 'weiling@warehouse.com', roles: ['BRANCH_MANAGER'], branchCodes: ['PNG'], department: 'Penang', jobTitle: 'Branch Manager' },
  { code: 'RI', name: 'Rosnah Ismail', email: 'rosnah@warehouse.com', roles: ['FINANCE_DIRECTOR', 'FINANCE_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Finance', jobTitle: 'Finance Director' },
  { code: 'RAH', name: 'Rahim', email: 'rahim@warehouse.com', roles: ['STORE', 'REQUESTER', 'SALES_STORE'], branchCodes: ['HQ', 'PNG'], department: 'Warehouse', jobTitle: 'Store' },
  { code: 'NUR', name: 'Nurul', email: 'nurul@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'HAF', name: 'Hafiz', email: 'hafiz@warehouse.com', roles: ['REQUESTER', 'STORE'], branchCodes: ['HQ'], department: 'Production' },
  { code: 'SIT', name: 'Siti', email: 'siti@warehouse.com', roles: ['REQUESTER'], branchCodes: ['HQ'], department: 'Office', jobTitle: 'Admin' },
  { code: 'ADM', name: 'Admin', email: 'admin@warehouse.com', roles: ['ADMIN'], branchCodes: ['HQ', 'PNG'], jobTitle: 'Admin' },
  // Sales (SALES_SEED_DATA.md). Aina sells, bills and delivers at HQ, as in the mockups.
  { code: 'AR', name: 'Aina Rahman', email: 'aina@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING', 'SALES_STORE'], branchCodes: ['HQ'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'LWJ', name: 'Lim Wei Jie', email: 'weijie@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING'], branchCodes: ['PNG'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'FO', name: 'Faizal Omar', email: 'faizal@warehouse.com', roles: ['SALES_AGENT', 'SALES_BILLING'], branchCodes: ['HQ', 'PNG'], department: 'Sales', jobTitle: 'Sales agent' },
  { code: 'NA', name: 'Nor Azlina', email: 'azlina@warehouse.com', roles: ['SALES_MANAGER'], branchCodes: ['HQ', 'PNG'], department: 'Sales', jobTitle: 'Sales Manager' },
  { code: 'SC1', name: 'Siti Counter 1', email: 'counter1@warehouse.com', roles: ['COUNTER_STAFF'], branchCodes: ['HQ'], department: 'Showroom', jobTitle: 'Showroom counter' },
];

const WAREHOUSES = [
  { code: 'HQ-MAIN', name: 'HQ Shah Alam · main', branchCode: 'HQ' },
  { code: 'HQ-DMG', name: 'HQ Shah Alam · damaged goods', branchCode: 'HQ' },
  { code: 'PNG-MAIN', name: 'Penang · main', branchCode: 'PNG' },
];

const LOCATIONS = [
  ...['B-01', 'B-02', 'B-03', 'B-04', 'B-05'].map((rack) => ({ warehouseCode: 'HQ-MAIN', code: `HQ-MAIN/${rack}`, name: `Rack ${rack}` })),
  { warehouseCode: 'HQ-DMG', code: 'HQ-DMG/Q-01', name: 'Quarantine bay' },
  { warehouseCode: 'PNG-MAIN', code: 'PNG-MAIN/A-01', name: 'Rack A-01' },
  { warehouseCode: 'PNG-MAIN', code: 'PNG-MAIN/A-02', name: 'Rack A-02' },
];

const UOMS = [
  { code: 'ROLL', name: 'Roll', decimals: 0 },
  { code: 'PCS', name: 'Piece', decimals: 0 },
  { code: 'BOX', name: 'Box', decimals: 0 },
  { code: 'TIN', name: 'Tin', decimals: 0 },
  { code: 'SET', name: 'Set', decimals: 0 },
  { code: 'LOT', name: 'Lot', decimals: 0 },
  { code: 'PACK', name: 'Pack', decimals: 0 },
  { code: 'M', name: 'Metre', decimals: 2 },
];

const TAX_CODES = [
  { code: 'SST10', name: 'SST 10%', rate: '0.1000', validFrom: '2018-09-01' },
  { code: 'SVC8', name: 'Service tax 8%', rate: '0.0800', validFrom: '2024-03-01' },
  { code: 'EXEMPT', name: 'Exempt', rate: '0.0000', validFrom: '2018-09-01' },
];

const SUPPLIERS: {
  code: string; name: string; shortName: string; category: string; email?: string; sst: boolean; walkIn?: boolean;
}[] = [
  { code: 'S-0021', name: 'Kilang Kain Jaya Sdn Bhd', shortName: 'Kilang Kain Jaya', category: 'Fabric', email: 'sales@kilangkainjaya.my', sst: true },
  { code: 'S-0034', name: 'Tekstil Utara Enterprise', shortName: 'Tekstil Utara', category: 'Fabric, foam', email: 'sales@tekstilutara.my', sst: true },
  { code: 'S-0009', name: 'Hardware Mart Klang', shortName: 'Hardware Mart Klang', category: 'Hardware', email: 'orders@hardwaremartklang.my', sst: false },
  { code: 'S-0047', name: 'Perabot Kayu Timur', shortName: 'Perabot Kayu Timur', category: 'Furniture, timber', email: 'sales@perabotkayutimur.my', sst: true },
  { code: 'S-0052', name: 'Mesin Jahit Pro Sdn Bhd', shortName: 'Mesin Jahit Pro', category: 'Sewing machines and parts', email: 'accounts@mesinjahitpro.my', sst: true },
  { code: 'S-0015', name: 'Cat Warna Sdn Bhd', shortName: 'Cat Warna', category: 'Lacquer, stain', email: 'sales@catwarna.my', sst: true },
  { code: 'S-0061', name: 'Kilang Perabot Selatan', shortName: 'Perabot Selatan', category: 'Furniture', email: 'sales@perabotselatan.my', sst: true },
  { code: 'S-0063', name: 'Venir Jaya Enterprise', shortName: 'Venir Jaya', category: 'Veneer', email: 'sales@venirjaya.my', sst: true },
  { code: 'S-0070', name: 'Kedai Runcit Maju', shortName: 'Kedai Runcit Maju', category: 'Walk-in shop', sst: false, walkIn: true },
  { code: 'S-0071', name: 'Kedai Elektrik Jaya', shortName: 'Kedai Elektrik Jaya', category: 'Walk-in shop', sst: true, walkIn: true },
];

interface ItemSeed {
  code: string; name: string; uom: string; type: MdmItemType; tax: string; group: string;
  supplier?: string; reorder?: number; pack?: number; stock?: number; used30?: number;
  sellable?: boolean; buyToOrder?: boolean;
}

// Columns from SEED_DATA.md "Items"; pack sizes and 30-day usage are invented (FB-OAK-01's 70 is from the mockup).
const ITEMS: ItemSeed[] = [
  { code: 'FB-OAK-01', name: 'Chair fabric roll, oatmeal', uom: 'ROLL', type: 'STOCK', tax: 'SST10', group: 'Fabric', supplier: 'S-0021', reorder: 50, stock: 30, used30: 70 },
  { code: 'FB-GRY-02', name: 'Chair fabric roll, grey', uom: 'ROLL', type: 'STOCK', tax: 'SST10', group: 'Fabric', supplier: 'S-0034', reorder: 30, stock: 40, used30: 25 },
  { code: 'FM-SEA-05', name: 'Seat foam sheet', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Foam', supplier: 'S-0034', reorder: 40, stock: 12, used30: 30 },
  { code: 'SC-WOD-08', name: 'Wood screw 4 × 40 mm, box of 200', uom: 'BOX', type: 'STOCK', tax: 'SST10', group: 'Hardware', supplier: 'S-0009', reorder: 20, pack: 10, stock: 5, used30: 18 },
  { code: 'VR-LAC-01', name: 'Lacquer, 5 L', uom: 'TIN', type: 'STOCK', tax: 'SST10', group: 'Finishing', supplier: 'S-0015', reorder: 10, pack: 4, stock: 3, used30: 9 },
  { code: 'PT-STN-03', name: 'Wood stain, walnut, 5 L', uom: 'TIN', type: 'STOCK', tax: 'SST10', group: 'Finishing', supplier: 'S-0015', reorder: 20, stock: 6, used30: 14 },
  { code: 'HW-HNG-02', name: 'Soft-close hinge, pack of 10', uom: 'PACK', type: 'STOCK', tax: 'EXEMPT', group: 'Hardware', supplier: 'S-0009', reorder: 10, stock: 20, used30: 12 },
  { code: 'DR-RUN-04', name: 'Drawer runner', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Hardware', supplier: 'S-0009', reorder: 20, stock: 8, used30: 15 },
  { code: 'CH-DIN-01', name: 'Dining chair, solid oak', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Seating', supplier: 'S-0047', reorder: 50, stock: 0, used30: 0, sellable: true },
  { code: 'TB-DIN-06', name: 'Dining table, 6-seater', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Tables', supplier: 'S-0047', reorder: 5, stock: 4, used30: 2, sellable: true },
  { code: 'SF-CUS-03', name: 'Custom 3-seater sofa, grey linen', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Sofas', supplier: 'S-0047', reorder: 0, stock: 0, used30: 0, sellable: true, buyToOrder: true },
  { code: 'MJ-IND-01', name: 'Industrial sewing machine', uom: 'PCS', type: 'ASSET', tax: 'EXEMPT', group: 'Machinery', supplier: 'S-0052' },
  { code: 'MJ-PF-11', name: 'Presser foot set', uom: 'SET', type: 'STOCK', tax: 'EXEMPT', group: 'Machine parts', supplier: 'S-0052', reorder: 5, stock: 2, used30: 3 },
  { code: 'SV-INS-01', name: 'Installation and operator training', uom: 'LOT', type: 'SERVICE', tax: 'SVC8', group: 'Service', supplier: 'S-0052' },
  { code: 'OF-TNR-01', name: 'Printer toner', uom: 'PCS', type: 'NON_STOCK', tax: 'SST10', group: 'Office' },
  // Invented: things the mockups buy that were not in the item list (agreed with the user).
  { code: 'VN-TEK-01', name: 'Teak veneer sheet', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Timber', supplier: 'S-0063' },
  { code: 'TM-OAK-01', name: 'Oak timber plank', uom: 'PCS', type: 'STOCK', tax: 'SST10', group: 'Timber', supplier: 'S-0047' },
  { code: 'OF-DSK-01', name: 'Standing desk', uom: 'PCS', type: 'NON_STOCK', tax: 'SST10', group: 'Office' },
  { code: 'OF-CLN-01', name: 'Cleaning supplies', uom: 'LOT', type: 'NON_STOCK', tax: 'EXEMPT', group: 'Office', supplier: 'S-0070' },
  { code: 'PT-SMP-01', name: 'Sample paint tin', uom: 'TIN', type: 'NON_STOCK', tax: 'SST10', group: 'Finishing', supplier: 'S-0015' },
  { code: 'TL-DRL-01', name: 'Drill bit set', uom: 'SET', type: 'NON_STOCK', tax: 'SST10', group: 'Tools', supplier: 'S-0009' },
  { code: 'EL-EXT-01', name: 'Extension cord', uom: 'PCS', type: 'NON_STOCK', tax: 'SST10', group: 'Electrical', supplier: 'S-0071' },
  { code: 'SV-FRT-01', name: 'Freight charge', uom: 'LOT', type: 'SERVICE', tax: 'EXEMPT', group: 'Service' },
  { code: 'SV-TNT-01', name: 'Paint tinting', uom: 'LOT', type: 'SERVICE', tax: 'EXEMPT', group: 'Service', supplier: 'S-0015' },
];

/** Sales-order needs until Sales exists. Customers of SO-0005/SO-0008 and all totals except SO-0003 are invented. */

export async function seedMasterData(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;

  for (const b of BRANCHES) {
    await prisma.mdmBranch.upsert({
      where: { tenantId_code: { tenantId, code: b.code } },
      update: { name: b.name, isActive: true },
      create: { tenantId, ...b },
    });
  }

  for (const u of USERS) {
    const data = { name: u.name, email: u.email, roles: u.roles, branchCodes: u.branchCodes, department: u.department ?? null, jobTitle: u.jobTitle ?? null, isActive: true };
    const row = await prisma.mdmUser.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: data,
      create: { tenantId, code: u.code, ...data },
    });
    ctx.users.set(row.code, row);
  }

  for (const w of WAREHOUSES) {
    const row = await prisma.mdmWarehouse.upsert({
      where: { tenantId_code: { tenantId, code: w.code } },
      update: { name: w.name, branchCode: w.branchCode, isActive: true },
      create: { tenantId, ...w },
    });
    ctx.warehouses.set(row.code, row);
  }

  for (const l of LOCATIONS) {
    await prisma.mdmLocation.upsert({
      where: { tenantId_code: { tenantId, code: l.code } },
      update: { name: l.name, warehouseCode: l.warehouseCode, isActive: true },
      create: { tenantId, ...l },
    });
  }

  for (const u of UOMS) {
    await prisma.mdmUom.upsert({
      where: { tenantId_code: { tenantId, code: u.code } },
      update: { name: u.name, decimals: u.decimals },
      create: { tenantId, ...u },
    });
  }
  await prisma.mdmUomConversion.upsert({
    where: { tenantId_itemCode_fromUom_toUom: { tenantId, itemCode: 'FB-OAK-01', fromUom: 'ROLL', toUom: 'M' } },
    update: { factor: new Prisma.Decimal(50) },
    create: { tenantId, itemCode: 'FB-OAK-01', fromUom: 'ROLL', toUom: 'M', factor: new Prisma.Decimal(50) },
  });

  for (const t of TAX_CODES) {
    const data = { name: t.name, rate: new Prisma.Decimal(t.rate), country: 'MY', validFrom: day(t.validFrom), isActive: true };
    const row = await prisma.mdmTaxCode.upsert({
      where: { tenantId_code: { tenantId, code: t.code } },
      update: data,
      create: { tenantId, code: t.code, ...data },
    });
    ctx.taxes.set(row.code, row);
  }

  for (const s of SUPPLIERS) {
    const data = {
      name: s.name,
      shortName: s.shortName,
      category: s.category,
      email: s.email ?? null,
      sstNo: s.sst ? `SST-${s.code.replace('S-', '')}` : null,
      paymentTermDays: 30,
      currency: 'MYR',
      isWalkIn: s.walkIn ?? false,
      status: 'ACTIVE' as const,
    };
    const row = await prisma.mdmSupplier.upsert({
      where: { tenantId_code: { tenantId, code: s.code } },
      update: data,
      create: { tenantId, code: s.code, ...data },
    });
    ctx.suppliers.set(row.code, row);
  }

  for (const i of ITEMS) {
    const data = {
      name: i.name,
      itemGroup: i.group,
      type: i.type,
      baseUom: i.uom,
      purchaseUom: null,
      isPurchasable: true,
      isSellable: i.sellable ?? false,
      isBuyToOrder: i.buyToOrder ?? false,
      purchaseTaxCode: i.tax,
      salesTaxCode: i.sellable ? 'SST10' : null,
      preferredSupplierCode: i.supplier ?? null,
      reorderLevel: i.reorder === undefined ? null : new Prisma.Decimal(i.reorder),
      packSize: new Prisma.Decimal(i.pack ?? 1),
      status: 'ACTIVE' as const,
    };
    const row = await prisma.mdmItem.upsert({
      where: { tenantId_code: { tenantId, code: i.code } },
      update: data,
      create: { tenantId, code: i.code, ...data },
    });
    ctx.items.set(row.code, row);
  }

  // PO-0003's note: "Contract price, no RFQ needed."
  await prisma.mdmContractPrice.deleteMany({ where: { tenantId } });
  await prisma.mdmContractPrice.create({
    data: { tenantId, itemCode: 'SF-CUS-03', supplierCode: 'S-0047', unitPrice: new Prisma.Decimal(2100), validFrom: day('2026-01-01'), validTo: day('2026-12-31') },
  });

  // Stock on hand: read-only stub until Inventory is connected. "Last run 29 Sep, 1:00 AM".
  await prisma.invStockSnapshot.deleteMany({ where: { tenantId } });
  await prisma.invStockSnapshot.createMany({
    data: ITEMS.filter((i) => i.stock !== undefined).map((i) => ({
      tenantId,
      warehouseCode: 'HQ-MAIN',
      itemCode: i.code,
      onHand: new Prisma.Decimal(i.stock ?? 0),
      usedLast30Days: new Prisma.Decimal(i.used30 ?? 0),
      asOf: kl('2026-09-29', '01:00'),
    })),
  });

  // Sales-order demand is no longer stubbed: Purchase keeps its own copy from Sales events (pur_sales_demand).
  await prisma.salDemandStub.deleteMany({ where: { tenantId } });
}
