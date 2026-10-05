import 'vue-router'

export {}

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen code from docs/design/SCREENS.md: "P09" */
    code?: string
    /** Page title, also the last breadcrumb */
    title?: string
    /** Which module theme and menu: data-module on the layout */
    module?: 'purchase' | 'sales'
    /** bare = own full-page design (launcher); module-home = white header; module = sidebar layout */
    layout?: 'bare' | 'module-home' | 'module'
    /** Sidebar group shown on this page */
    menuGroup?: 'transaction' | 'billing' | 'policies' | 'reports'
    /** Sidebar item to highlight */
    menuItem?: string
    /** Document pages: the list they belong to, for the breadcrumb (Home › Purchase Order › PO-0001) */
    parent?: { title: string; to: string }
    /** Build step that delivers the real screen (placeholder until then) */
    step?: number
    /** Mockup file in docs/design/mockups */
    mockup?: string
  }
}
