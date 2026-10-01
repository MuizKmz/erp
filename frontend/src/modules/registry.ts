import { purchaseApi } from './purchase/api/purchase'
import { PURCHASE_MENU, type MenuGroup } from './purchase/menu'

/** What the shared layouts need to know about a module. Sales adds its entry after Purchase. */
export interface ModuleDef {
  key: 'purchase' | 'sales'
  label: string
  home: string
  menu: MenuGroup[]
  approvalsTo: string
  approvalsCount: () => Promise<{ waitingForMe: number }>
}

export const MODULES: Record<'purchase', ModuleDef> = {
  purchase: {
    key: 'purchase',
    label: 'Purchase',
    home: '/purchase',
    menu: PURCHASE_MENU,
    approvalsTo: '/purchase/approvals',
    approvalsCount: purchaseApi.approvalsCount,
  },
}

/** The module a route belongs to. Only Purchase exists in phase 1, so it is also the fallback. */
export function moduleDef(key: string | undefined): ModuleDef {
  return key && key in MODULES ? MODULES[key as keyof typeof MODULES] : MODULES.purchase
}
