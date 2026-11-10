import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { MODULES, type ModuleKey } from '@/modules/registry'

/** The permission that opens each module: the view key of its catalogue on the server. */
const VIEW_KEY: Record<ModuleKey, string> = {
  purchase: 'purchase.view',
  sales: 'sales.view',
  core: 'core.view',
  config: 'config.view',
  wms: 'wms.view',
}

/** What a page needs to open: its own permission, else its module's view permission; null when anyone may open it. */
export function requiredPermission(route: RouteLocationNormalizedLoaded): string | null {
  if (route.meta.permission !== undefined) return route.meta.permission
  return route.meta.module ? VIEW_KEY[route.meta.module] : null
}

/** "Purchase" for a module page; the page's own title when it asks for more than viewing the module. */
export function blockedName(route: RouteLocationNormalizedLoaded): string {
  const module = route.meta.module ? MODULES[route.meta.module].label : ''
  if (route.meta.permission && route.meta.title) return route.meta.title
  return module || route.meta.title || 'this page'
}
