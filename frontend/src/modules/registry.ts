import type { MenuGroup } from './common/menu'
import { CONFIG_MENU } from './configuration/menu'
import { CORE_MENU } from './core/menu'
import { purchaseApi } from './purchase/api/purchase'
import { PURCHASE_MENU } from './purchase/menu'
import { salesApi } from './sales/api/sales'
import { SALES_MENU } from './sales/menu'

export type ModuleKey = 'purchase' | 'sales' | 'core' | 'config'

/** What the shared layouts need to know about a module. */
export interface ModuleDef {
  key: ModuleKey
  label: string
  home: string
  menu: MenuGroup[]
  /** Left out by modules without approvals (Core, Configuration): the top bar then shows no Approvals link. */
  approvalsTo?: string
  approvalsCount?: () => Promise<{ waitingForMe: number }>
}

export const MODULES: Record<ModuleKey, ModuleDef> = {
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
  core: {
    key: 'core',
    label: 'Core',
    home: '/core',
    menu: CORE_MENU,
  },
  config: {
    key: 'config',
    label: 'Configuration',
    home: '/config',
    menu: CONFIG_MENU,
  },
}

/** The module a route belongs to. Purchase is the fallback for routes outside a module. */
export function moduleDef(key: string | undefined): ModuleDef {
  return key && key in MODULES ? MODULES[key as keyof typeof MODULES] : MODULES.purchase
}
