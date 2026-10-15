import { Building2, GitFork, History, KeyRound, ScrollText, Shield, ShieldCheck, User, UserCog, Users } from '@lucide/vue'
import type { MenuGroup } from '../common/menu'

/** Configuration sidebar (CfgHome.html and the other Configuration mockups). Labels exactly as in the mockups. */
export const CONFIG_MENU: MenuGroup[] = [
  {
    key: 'organisation',
    title: 'Organisation',
    icon: Building2,
    to: '/config/company',
    items: [
      { key: 'company', label: 'Company', to: '/config/company', icon: Building2 },
      { key: 'branches', label: 'Branches', to: '/config/branches', icon: GitFork },
    ],
  },
  {
    key: 'access',
    title: 'Users & Access',
    icon: Users,
    to: '/config/users',
    items: [
      { key: 'users', label: 'Users', to: '/config/users', icon: Users },
      { key: 'roles', label: 'Roles', to: '/config/roles', icon: UserCog },
      { key: 'permissions', label: 'Who Can Do What', to: '/config/permissions', icon: KeyRound },
    ],
  },
  {
    key: 'security',
    title: 'Security',
    icon: Shield,
    to: '/config/sign-in-settings',
    items: [
      { key: 'sign-in-settings', label: 'Sign-in Settings', to: '/config/sign-in-settings', icon: ShieldCheck },
      { key: 'security-log', label: 'Security Log', to: '/config/security-log', icon: ScrollText },
      { key: 'audit', label: 'Audit Trail', to: '/config/audit', icon: History },
    ],
  },
  {
    key: 'account',
    title: 'My Account',
    icon: User,
    to: '/account',
    items: [{ key: 'account', label: 'My Account', to: '/account', icon: User }],
  },
]
