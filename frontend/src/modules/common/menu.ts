import type { Component } from 'vue'

/** Sidebar types shared by every module's menu (and the shared layouts). */
export interface MenuItem {
  key: string
  label: string
  to: string
  icon: Component
}

export type MenuGroupKey =
  | 'transaction'
  | 'billing'
  | 'policies'
  | 'reports'
  | 'catalog'
  | 'parties'
  | 'pricing'
  | 'warehouses'
  | 'setup'
  | 'organisation'
  | 'access'
  | 'security'
  | 'account'

export interface MenuGroup {
  key: MenuGroupKey
  title: string
  icon: Component
  /** Where the home tile for this group goes */
  to: string
  items: MenuItem[]
}
