import type { Component } from 'vue'
import { ChartLine, ClipboardCheck, Database, Factory, Sun, Warehouse } from '@lucide/vue'
import type { ModuleTile } from '@/api/session'
import { MODULES } from './registry'

/** Tile colour (a theme token), icon and one-line purpose per module: the launcher and the module switcher. */
export const TILE_STYLE: Record<ModuleTile['code'], { icon: Component; color: string; description: string }> = {
  core: { icon: Database, color: 'var(--tile-core)', description: 'Items, customers, suppliers, tax and price lists.' },
  purchase: { icon: ClipboardCheck, color: 'var(--tile-purchase)', description: 'Requests, quotes, orders, goods receipt and supplier bills.' },
  sales: { icon: ChartLine, color: 'var(--tile-sales)', description: 'Enquiries, quotations, sales orders and delivery.' },
  mes: { icon: Factory, color: 'var(--tile-mes)', description: 'Production orders and shop-floor tracking.' },
  wms: { icon: Warehouse, color: 'var(--tile-wms)', description: 'Warehouse locations, picking and stock moves.' },
  config: { icon: Sun, color: 'var(--tile-config)', description: 'Users, roles and company settings.' },
}

/** A module this app has built and the person may open (the server gives it a route). */
export const isBuilt = (t: ModuleTile): boolean => !!t.route && t.code in MODULES
