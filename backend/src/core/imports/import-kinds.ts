/**
 * What each import reads (C14): its columns, as the template writes them, and the columns the Check table shows.
 * A file needs only the columns it changes: a known code with a Phone column updates phones and nothing else.
 */
import type { ImportColumn, ImportKind } from './imports.rules';

export interface KindDefinition {
  kind: ImportKind;
  label: string;
  /** "New customer" */
  noun: string;
  columns: ImportColumn[];
  /** Columns the file must have. */
  required: string[];
  /** The Check table's columns, after Row and before Result. */
  display: { key: string; label: string; numeric?: boolean }[];
  /** One line under the template, about codes and blank cells. */
  note: string;
}

const party = (extra: ImportColumn[]): ImportColumn[] => [
  { key: 'tin', header: 'TIN' },
  { key: 'idType', header: 'ID type' },
  { key: 'idNumber', header: 'ID number', aliases: ['Registration no', 'Reg no'] },
  { key: 'salesTaxNo', header: 'Sales tax no', aliases: ['SST no'] },
  { key: 'serviceTaxNo', header: 'Service tax no' },
  { key: 'einvoiceEmail', header: 'e-Invoice email' },
  { key: 'contact', header: 'Contact', aliases: ['Contact name'] },
  { key: 'email', header: 'Email' },
  { key: 'phone', header: 'Phone' },
  ...extra,
];

export const IMPORT_KIND_DEFINITIONS: Record<ImportKind, KindDefinition> = {
  customers: {
    kind: 'customers',
    label: 'Customers',
    noun: 'customer',
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'branch', header: 'Branch' },
      { key: 'priceList', header: 'Price list' },
      { key: 'creditTerm', header: 'Credit term' },
      { key: 'creditLimit', header: 'Credit limit' },
      { key: 'overdueLimit', header: 'Overdue limit' },
      { key: 'category', header: 'Category' },
      { key: 'area', header: 'Area' },
      { key: 'agent', header: 'Sales agent', aliases: ['Agent'] },
      ...party([
        { key: 'billingAddress', header: 'Billing address' },
        { key: 'deliveryAddress', header: 'Delivery address' },
        { key: 'taxMode', header: 'Tax mode' },
      ]),
    ],
    required: [],
    display: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'branch', label: 'Branch' },
      { key: 'priceList', label: 'Price list' },
      { key: 'creditTerm', label: 'Credit term' },
      { key: 'creditLimit', label: 'Credit limit (RM)', numeric: true },
    ],
    note: 'Leave Code empty to add a customer with the next number. Blank cells leave a known customer as it is.',
  },
  suppliers: {
    kind: 'suppliers',
    label: 'Suppliers',
    noun: 'supplier',
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'shortName', header: 'Short name' },
      { key: 'supplies', header: 'Supplies' },
      { key: 'walkIn', header: 'Walk-in shop' },
      { key: 'paymentTerm', header: 'Payment term' },
      { key: 'currency', header: 'Currency' },
      ...party([{ key: 'address', header: 'Address' }]),
    ],
    required: [],
    display: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'supplies', label: 'Supplies' },
      { key: 'paymentTerm', label: 'Payment term' },
      { key: 'tin', label: 'TIN' },
    ],
    note: 'Leave Code empty to add a supplier with the next number. Blank cells leave a known supplier as it is. Contract prices are kept on the supplier form.',
  },
  items: {
    kind: 'items',
    label: 'Items',
    noun: 'item',
    columns: [
      { key: 'code', header: 'Code' },
      { key: 'name', header: 'Name' },
      { key: 'group', header: 'Group', aliases: ['Item group'] },
      { key: 'type', header: 'Type' },
      { key: 'baseUnit', header: 'Base unit' },
      { key: 'barcode', header: 'Barcode' },
      { key: 'classification', header: 'e-Invoice classification', aliases: ['Classification'] },
      { key: 'canBuy', header: 'Can be bought' },
      { key: 'buyToOrder', header: 'Buy to order' },
      { key: 'purchaseUnit', header: 'Purchase unit' },
      { key: 'purchaseTax', header: 'Purchase tax' },
      { key: 'preferredSupplier', header: 'Preferred supplier' },
      { key: 'reorderLevel', header: 'Reorder level' },
      { key: 'packSize', header: 'Pack size' },
      { key: 'canSell', header: 'Can be sold' },
      { key: 'salesUnit', header: 'Sales unit' },
      { key: 'salesTax', header: 'Sales tax' },
      { key: 'standardCost', header: 'Standard cost' },
    ],
    required: ['code'],
    display: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'group', label: 'Group' },
      { key: 'baseUnit', label: 'Base unit' },
      { key: 'purchaseTax', label: 'Purchase tax' },
      { key: 'salesTax', label: 'Sales tax' },
    ],
    note: 'Items keep the code you type: a known code updates that item, a new code adds one. Blank cells leave a known item as it is. Units and conversions stay on the item form.',
  },
  prices: {
    kind: 'prices',
    label: 'Price-list prices',
    noun: 'price',
    columns: [
      { key: 'priceList', header: 'Price list' },
      { key: 'item', header: 'Item', aliases: ['Item code'] },
      { key: 'unit', header: 'Unit' },
      { key: 'price', header: 'Price', aliases: ['Unit price'] },
      { key: 'from', header: 'From', aliases: ['Valid from'] },
    ],
    required: ['priceList', 'item', 'price', 'from'],
    display: [
      { key: 'priceList', label: 'Price list' },
      { key: 'item', label: 'Item' },
      { key: 'unit', label: 'Unit' },
      { key: 'price', label: 'Price (RM)', numeric: true },
      { key: 'from', label: 'From' },
    ],
    note: 'A price list, item, unit and date that exist update that price; others add one. Prices start today or later. Dates are day first (1/11/2026) or 2026-11-01.',
  },
};
