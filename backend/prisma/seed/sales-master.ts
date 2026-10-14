/**
 * Master data for Sales (docs/design/SALES_SEED_DATA.md → Master data): customers, price lists, the items
 * Sales sells, and stock at Penang. Upserted on business codes. The Sales users are in master-data.ts.
 *
 * Invented (not in a mockup): standard costs (for the estimated margin), barcodes, TB-RST-04 and SF-BTH-02.
 * CH-DIN-01 and TB-DIN-06 costs are set so QT-0012 shows the mockup's 28.6% margin.
 */
import { MdmItemType, Prisma } from '@prisma/client';
import { AS_SEEDED, day, kl, type SeedCtx } from './util';

export const PRICE_LISTS = [
  { code: 'STD-2026', name: 'Standard 2026' },
  { code: 'RES-2026', name: 'Reseller 2026' },
];

interface SaleItem {
  code: string; name: string; group: string; uom: string; type?: MdmItemType; tax: string;
  std?: string; res?: string; cost: string; barcode?: string; sellable?: boolean; exists?: boolean;
}

/** `exists`: already seeded by master-data.ts for Purchase; only prices, cost and barcode are added here. */
export const SALE_ITEMS: SaleItem[] = [
  { code: 'CH-DIN-01', name: 'Dining chair, solid oak', group: 'Seating', uom: 'PCS', tax: 'SST10', std: '250.00', res: '235.00', cost: '170.00', barcode: '9551234000011', exists: true },
  { code: 'CH-DIN-02', name: 'Dining chair, walnut', group: 'Seating', uom: 'PCS', tax: 'SST10', std: '280.00', res: '265.00', cost: '182.00', barcode: '9551234000028' },
  { code: 'CH-BAR-01', name: 'Bar stool, oak', group: 'Seating', uom: 'PCS', tax: 'SST10', std: '190.00', res: '180.00', cost: '120.00', barcode: '9551234000035' },
  { code: 'CH-OFF-02', name: 'Office chair, mesh', group: 'Seating', uom: 'PCS', tax: 'SST10', std: '300.00', res: '285.00', cost: '195.00', barcode: '9551234000042' },
  { code: 'CH-DIN-09', name: 'Dining chair, rattan', group: 'Seating', uom: 'PCS', tax: 'SST10', std: '220.00', res: '210.00', cost: '140.00', barcode: '9551234000059' },
  { code: 'CH-KID-01', name: 'Kids chair, beech', group: 'Seating', uom: 'PCS', tax: 'SST10', cost: '60.00', barcode: '9551234000066', sellable: false },
  { code: 'TB-DIN-06', name: 'Dining table, 6-seater', group: 'Tables', uom: 'PCS', tax: 'SST10', std: '1450.00', res: '1380.00', cost: '865.40', barcode: '9551234000073', exists: true },
  { code: 'TB-RST-04', name: 'Restaurant table, 4-seater', group: 'Tables', uom: 'PCS', tax: 'SST10', std: '850.00', cost: '540.00', barcode: '9551234000080' },
  { code: 'TB-COF-01', name: 'Coffee table, teak', group: 'Tables', uom: 'PCS', tax: 'SST10', std: '1200.00', cost: '760.00', barcode: '9551234000097' },
  { code: 'TB-BED-01', name: 'Bedside table', group: 'Tables', uom: 'PCS', tax: 'SST10', std: '280.00', cost: '175.00', barcode: '9551234000103' },
  { code: 'TB-OUT-02', name: 'Outdoor table, teak', group: 'Tables', uom: 'PCS', tax: 'SST10', std: '1600.00', cost: '1020.00', barcode: '9551234000110' },
  { code: 'BD-KNG-01', name: 'King bed frame, teak', group: 'Beds', uom: 'PCS', tax: 'SST10', std: '1400.00', cost: '900.00', barcode: '9551234000127' },
  { code: 'SF-CUS-03', name: 'Custom 3-seater sofa, grey linen', group: 'Sofas', uom: 'PCS', tax: 'SST10', std: '3200.00', cost: '2100.00', exists: true },
  { code: 'SF-BTH-02', name: 'Booth seat, 2-seater', group: 'Sofas', uom: 'PCS', tax: 'SST10', std: '1190.00', cost: '760.00', barcode: '9551234000134' },
  { code: 'ST-BAR-02', name: 'Bar stool, metal', group: 'Stools', uom: 'PCS', tax: 'SST10', std: '100.00', cost: '58.00', barcode: '9551234000141' },
  { code: 'CB-SHO-01', name: 'Shoe cabinet', group: 'Cabinets', uom: 'PCS', tax: 'SST10', std: '350.00', cost: '215.00', barcode: '9551234000158' },
  { code: 'CU-SET-02', name: 'Seat cushion set', group: 'Soft goods', uom: 'SET', tax: 'SST10', std: '60.00', cost: '32.00', barcode: '9551234000165' },
  { code: 'SV-DEL-01', name: 'Delivery trip, Klang Valley', group: 'Services', uom: 'TRIP', type: 'SERVICE', tax: 'SVC8', std: '350.00', cost: '200.00' },
];

const CUSTOMERS = [
  {
    code: 'C-0012', name: 'Hotel Seri Bayu Sdn Bhd', category: 'Hospitality', area: 'Central', branchCode: 'HQ', agent: 'AR', priceList: 'STD-2026',
    creditLimit: '150000.00', overdueLimit: '5000.00', contact: 'Pn. Zarina Aziz', email: 'zarina@hotelseribayu.my', phone: '+60 3-2280 1188',
    billing: 'Hotel Seri Bayu Sdn Bhd, Jalan Pantai Baharu, 59200 Kuala Lumpur', delivery: 'Hotel Seri Bayu, Jalan Pantai Baharu, 59200 Kuala Lumpur', tin: 'C20881234050',
  },
  {
    code: 'C-0031', name: 'Kedai Perabot Maju', category: 'Reseller', area: 'Northern', branchCode: 'PNG', agent: 'LWJ', priceList: 'RES-2026',
    creditLimit: '60000.00', overdueLimit: '15000.00', contact: 'Ms. Tan Mei Ling', email: 'meiling@perabotmaju.my', phone: '+60 4-226 3301',
    billing: 'Kedai Perabot Maju, 22 Jalan Burma, 10050 George Town, Penang', delivery: 'Kedai Perabot Maju, 22 Jalan Burma, 10050 George Town, Penang', tin: 'C21550098010',
  },
  {
    code: 'C-0045', name: 'Syarikat Delta Trading', category: 'Trading', area: 'Central', branchCode: 'HQ', agent: 'FO', priceList: 'STD-2026',
    creditLimit: '20000.00', overdueLimit: '3000.00', contact: 'En. Hafiz Karim', email: 'hafiz@deltatrading.my', phone: '+60 3-5510 4471',
    billing: 'Syarikat Delta Trading, Lot 12 Jalan Kemajuan, 40000 Shah Alam', delivery: 'Syarikat Delta Trading, Lot 12 Jalan Kemajuan, 40000 Shah Alam', tin: 'C10334570020',
  },
  {
    code: 'C-0056', name: 'Restoran Selera Kampung', category: 'Food and beverage', area: 'Northern', branchCode: 'PNG', agent: 'FO', priceList: 'STD-2026',
    creditLimit: '15000.00', overdueLimit: '3000.00', contact: 'Mr. Ravi Kumar', email: 'ravi@selerakampung.my', phone: '+60 4-331 8820',
    billing: 'Restoran Selera Kampung, 8 Lebuh Chulia, 10200 George Town, Penang', delivery: 'Restoran Selera Kampung, 8 Lebuh Chulia, 10200 George Town, Penang', tin: 'IG22018845030',
  },
  {
    code: 'C-0078', name: 'Klinik Sihat Jaya', category: 'Healthcare', area: 'Central', branchCode: 'HQ', agent: 'FO', priceList: 'STD-2026',
    creditLimit: '15000.00', overdueLimit: '5000.00', contact: 'Dr. Nurul Huda', email: 'nurul.huda@kliniksihatjaya.my', phone: '+60 3-7803 2210',
    billing: 'Klinik Sihat Jaya, 3 Jalan SS2/24, 47300 Petaling Jaya', delivery: 'Klinik Sihat Jaya, 3 Jalan SS2/24, 47300 Petaling Jaya', tin: 'C24410922080',
  },
  {
    code: 'C-0102', name: 'Villa Damai Resort', category: 'Hospitality', area: 'Central', branchCode: 'HQ', agent: 'AR', priceList: 'STD-2026',
    creditLimit: '50000.00', overdueLimit: '5000.00', contact: 'Mr. Daniel Wong', email: 'daniel@villadamai.my', phone: '+60 3-6020 5577',
    billing: 'Villa Damai Resort, Jalan Bukit Tinggi, 28750 Bentong, Pahang', delivery: 'Villa Damai Resort, Jalan Bukit Tinggi, 28750 Bentong, Pahang', tin: 'C26110473040',
  },
];

export async function seedSalesMasterData(ctx: SeedCtx): Promise<void> {
  const { prisma, tenantId } = ctx;

  await prisma.mdmUom.upsert({
    where: { tenantId_code: { tenantId, code: 'TRIP' } },
    update: { name: 'Trip', decimals: 0, isActive: true, ...AS_SEEDED },
    create: { tenantId, code: 'TRIP', name: 'Trip', decimals: 0 },
  });

  for (const pl of PRICE_LISTS) {
    const data = { name: pl.name, currency: 'MYR', taxInclusive: false, validFrom: day('2026-01-01'), validTo: day('2026-12-31'), isActive: true, ...AS_SEEDED };
    await prisma.mdmPriceList.upsert({
      where: { tenantId_code: { tenantId, code: pl.code } },
      update: data,
      create: { tenantId, code: pl.code, ...data },
    });
  }

  for (const i of SALE_ITEMS) {
    const extra = { standardCost: new Prisma.Decimal(i.cost), barcode: i.barcode ?? null, salesTaxCode: i.tax, isSellable: i.sellable ?? true, einvoiceClassification: null, ...AS_SEEDED };
    const row = i.exists
      ? await prisma.mdmItem.update({ where: { tenantId_code: { tenantId, code: i.code } }, data: extra })
      : await prisma.mdmItem.upsert({
          where: { tenantId_code: { tenantId, code: i.code } },
          update: {
            name: i.name, itemGroup: i.group, type: i.type ?? 'STOCK', baseUom: i.uom, purchaseUom: null, salesUom: null, isPurchasable: false, isBuyToOrder: false,
            purchaseTaxCode: i.tax, preferredSupplierCode: null, reorderLevel: null, packSize: new Prisma.Decimal(1), status: 'ACTIVE', ...extra,
          },
          create: {
            tenantId, code: i.code, name: i.name, itemGroup: i.group, type: i.type ?? 'STOCK', baseUom: i.uom,
            isPurchasable: false, purchaseTaxCode: i.tax, status: 'ACTIVE', ...extra,
          },
        });
    ctx.items.set(row.code, row);
  }

  // Every price is valid from its list's start date (CORE_SEED_DATA.md → Price lists).
  const validFrom = day('2026-01-01');
  await prisma.mdmPriceListItem.deleteMany({ where: { tenantId } });
  await prisma.mdmPriceListItem.createMany({
    data: SALE_ITEMS.flatMap((i) => [
      ...(i.std ? [{ tenantId, priceListCode: 'STD-2026', itemCode: i.code, uomCode: i.uom, unitPrice: new Prisma.Decimal(i.std), validFrom }] : []),
      ...(i.res ? [{ tenantId, priceListCode: 'RES-2026', itemCode: i.code, uomCode: i.uom, unitPrice: new Prisma.Decimal(i.res), validFrom }] : []),
    ]),
  });

  for (const c of CUSTOMERS) {
    const data = {
      name: c.name, tin: c.tin, billingAddress: c.billing, deliveryAddress: c.delivery, contactName: c.contact, email: c.email, phone: c.phone,
      category: c.category, area: c.area, branchCode: c.branchCode, defaultAgentCode: c.agent, creditTermDays: 30,
      creditLimit: new Prisma.Decimal(c.creditLimit), overdueLimit: new Prisma.Decimal(c.overdueLimit), creditScope: null,
      priceListCode: c.priceList, taxMode: 'EXCLUSIVE', isCash: false, status: 'ACTIVE' as const,
      // e-Invoice identity (CORE_SEED_DATA.md choice 3): ID type BRN, no ID number known yet.
      idType: 'BRN' as const, idNumber: null, salesTaxNo: null, serviceTaxNo: null, einvoiceEmail: null,
      cameFromEnquiry: null, ...AS_SEEDED,
    };
    const row = await prisma.mdmCustomer.upsert({ where: { tenantId_code: { tenantId, code: c.code } }, update: data, create: { tenantId, code: c.code, ...data } });
    ctx.customers.set(row.code, row);
  }
  const cash = {
    name: 'Cash customer (walk-in)', tin: null, billingAddress: null, deliveryAddress: null, contactName: null, email: null, phone: null,
    category: 'Walk-in', area: null, branchCode: 'HQ', defaultAgentCode: null, creditTermDays: 0, creditLimit: null, overdueLimit: null,
    creditScope: null, priceListCode: 'STD-2026', taxMode: 'INCLUSIVE', isCash: true, status: 'ACTIVE' as const,
    idType: null, idNumber: null, salesTaxNo: null, serviceTaxNo: null, einvoiceEmail: null, cameFromEnquiry: null, ...AS_SEEDED,
  };
  const cashRow = await prisma.mdmCustomer.upsert({ where: { tenantId_code: { tenantId, code: 'C-CASH' } }, update: cash, create: { tenantId, code: 'C-CASH', ...cash } });
  ctx.customers.set(cashRow.code, cashRow);

  // Stock for the item picker (S04) and the delivery list (S15). CH-DIN-01 stays 0 so Purchase demand is unchanged.
  const asOf = kl('2026-09-29', '01:00');
  const stock: [warehouse: string, item: string, qty: number][] = [
    ['HQ-MAIN', 'BD-KNG-01', 24],
    ['PNG-MAIN', 'CH-DIN-02', 48],
    ['PNG-MAIN', 'CH-BAR-01', 22],
    ['PNG-MAIN', 'CH-OFF-02', 0],
    ['PNG-MAIN', 'CH-DIN-09', 36],
    ['PNG-MAIN', 'CH-KID-01', 12],
  ];
  await prisma.invStockSnapshot.createMany({
    data: stock.map(([warehouseCode, itemCode, qty]) => ({ tenantId, warehouseCode, itemCode, onHand: new Prisma.Decimal(qty), usedLast30Days: new Prisma.Decimal(0), asOf })),
  });
}
