import type { MenuGroup } from './common/menu'
import { purchaseApi } from './purchase/api/purchase'
import { PURCHASE_MENU } from './purchase/menu'
import { salesApi } from './sales/api/sales'
import { SALES_MENU } from './sales/menu'

/** What the shared layouts need to know about a module. */
export interface ModuleDef {
  key: 'purchase' | 'sales'
  label: string
  home: string
  menu: MenuGroup[]
  approvalsTo: string
  approvalsCount: () => Promise<{ waitingForMe: number }>
}

export const MODULES: Record<'purchase' | 'sales', ModuleDef> = {
  purchase: {
    key: 'purchase',
    label: 'Purchase',
    home: '/purchase',
    menu: PURCHASE_MENU,
    approvalsTo: '/purchase/approvals',
    approvalsCount: purchaseApi.approvalsCount,
  },
  sales: {
    key: 'sales',
    label: 'Sales',
    home: '/sales',
    menu: SALES_MENU,
    approvalsTo: '/sales/approvals',
    approvalsCount: salesApi.approvalsCount,
  },
}

/** The module a route belongs to. Purchase is the fallback for routes outside a module. */
export function moduleDef(key: string | undefined): ModuleDef {
  return key && key in MODULES ? MODULES[key as keyof typeof MODULES] : MODULES.purchase
}
