/** Entity type codes used in sys_activity for Core records (the record's id is the entity id). */
export const CORE_ENTITY = {
  ITEM: 'MDM_ITEM',
  UOM: 'MDM_UOM',
  CUSTOMER: 'MDM_CUSTOMER',
  SUPPLIER: 'MDM_SUPPLIER',
  PRICE_LIST: 'MDM_PRICE_LIST',
  TAX_CODE: 'MDM_TAX_CODE',
  WAREHOUSE: 'MDM_WAREHOUSE',
} as const;

export type CoreEntityType = (typeof CORE_ENTITY)[keyof typeof CORE_ENTITY];

/** Numbering keys in sys_number_sequence (module "core"). Other Core codes are typed by the user. */
export const CORE_DOC_TYPE = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
} as const;

/** Roles from Master Data that Core gives more than a look. */
export const CORE_ROLE = {
  MASTER_DATA_ADMIN: 'MASTER_DATA_ADMIN',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
  PURCHASE_BUYER: 'PURCHASE_BUYER',
  PURCHASE_MANAGER: 'PURCHASE_MANAGER',
} as const;

/** Events Core publishes (CLAUDE.md → Phase 3 · Events Core publishes). */
export const CORE_EVENT = {
  ITEM_CREATED: 'mdm.item.created',
  ITEM_UPDATED: 'mdm.item.updated',
  ITEM_DELETED: 'mdm.item.deleted',
  CUSTOMER_CREATED: 'mdm.customer.created',
  CUSTOMER_UPDATED: 'mdm.customer.updated',
  CUSTOMER_DELETED: 'mdm.customer.deleted',
  SUPPLIER_CREATED: 'mdm.supplier.created',
  SUPPLIER_UPDATED: 'mdm.supplier.updated',
  SUPPLIER_DELETED: 'mdm.supplier.deleted',
  PRICE_LIST_UPDATED: 'mdm.price_list.updated',
  PRICE_LIST_DELETED: 'mdm.price_list.deleted',
  TAX_CODE_UPDATED: 'mdm.tax_code.updated',
  UOM_UPDATED: 'mdm.uom.updated',
  UOM_DELETED: 'mdm.uom.deleted',
  WAREHOUSE_UPDATED: 'mdm.warehouse.updated',
} as const;
