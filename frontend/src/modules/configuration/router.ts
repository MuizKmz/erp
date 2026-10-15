import type { RouteRecordRaw } from 'vue-router'

const Placeholder = () => import('./views/PlaceholderView.vue')
const Company = () => import('./views/CompanyView.vue')
const Branches = () => import('./views/BranchesView.vue')

type Group = 'organisation' | 'access' | 'security' | 'account'

interface ScreenDef {
  code: string
  path: string
  name: string
  title: string
  group: Group
  item: string
  /** Configuration build step (A2–A7) that delivers the screen */
  step: number
  /** Approved design in docs/design/mockups */
  mockup: string
  parent?: { title: string; to: string }
  component?: RouteRecordRaw['component']
}

const doc = (title: string, to: string) => ({ title, to })

/**
 * Every Configuration screen inside the module layout (CLAUDE.md → Phase 4 · Screens). Screens not built yet show a
 * placeholder naming their step. Sign-in and two-factor (A02, A03) sit outside the layout and come with A5 and A6.
 */
const SCREENS: ScreenDef[] = [
  { code: 'A04', path: '/config/company', name: 'config-company', title: 'Company', group: 'organisation', item: 'company', step: 2, mockup: 'CfgCompany.html', component: Company },
  { code: 'A05', path: '/config/branches', name: 'config-branches', title: 'Branches', group: 'organisation', item: 'branches', step: 2, mockup: 'CfgBranches.html', component: Branches },
  { code: 'A06', path: '/config/users', name: 'config-users', title: 'Users', group: 'access', item: 'users', step: 3, mockup: 'CfgUserList.html' },
  { code: 'A07', path: '/config/users/:id', name: 'config-user', title: 'User', group: 'access', item: 'users', step: 3, mockup: 'CfgUserForm.html', parent: doc('Users', '/config/users') },
  { code: 'A08', path: '/config/roles', name: 'config-roles', title: 'Roles', group: 'access', item: 'roles', step: 4, mockup: 'CfgRoleList.html' },
  { code: 'A09', path: '/config/roles/:id', name: 'config-role', title: 'Role', group: 'access', item: 'roles', step: 4, mockup: 'CfgRoleForm.html', parent: doc('Roles', '/config/roles') },
  { code: 'A10', path: '/config/permissions', name: 'config-permissions', title: 'Who can do what', group: 'access', item: 'permissions', step: 4, mockup: 'CfgPermissions.html' },
  { code: 'A14', path: '/config/sign-in-settings', name: 'config-sign-in-settings', title: 'Sign-in settings', group: 'security', item: 'sign-in-settings', step: 6, mockup: 'CfgSignInSettings.html' },
  { code: 'A12', path: '/config/security-log', name: 'config-security-log', title: 'Security log', group: 'security', item: 'security-log', step: 7, mockup: 'CfgSecurityLog.html' },
  { code: 'A13', path: '/config/audit', name: 'config-audit', title: 'Audit trail', group: 'security', item: 'audit', step: 7, mockup: 'CfgAudit.html' },
  { code: 'A11', path: '/account', name: 'account', title: 'My account', group: 'account', item: 'account', step: 6, mockup: 'CfgMyAccount.html' },
]

export const configRoutes: RouteRecordRaw[] = [
  {
    path: '/config',
    name: 'config-home',
    component: () => import('./views/ConfigHomeView.vue'),
    meta: { code: 'A01', title: 'Configuration home', module: 'config', layout: 'module-home', mockup: 'CfgHome.html' },
  },
  ...SCREENS.map(
    (s): RouteRecordRaw => ({
      path: s.path,
      name: s.name,
      component: s.component ?? Placeholder,
      meta: {
        code: s.code,
        title: s.title,
        module: 'config',
        layout: 'module',
        menuGroup: s.group,
        menuItem: s.item,
        parent: s.parent,
        step: s.step,
        mockup: s.mockup,
      },
    }),
  ),
]
