import type { ModulePermissions } from '../platform/context/permission.rules';
import { AUDITOR_ROLE } from './roles/roles.rules';

/** Configuration permissions (CLAUDE.md → Phase 4 · Roles and permissions). Put on actions with @RequirePermission. */
export const CONFIG_PERMISSIONS = {
  VIEW: 'config.view',
  /** The company and its branches (A04, A05). */
  ORGANISATION_EDIT: 'config.organisation.edit',
  USER_EDIT: 'config.user.edit',
  ROLE_EDIT: 'config.role.edit',
  /** Sign-in settings (A14). */
  SETTINGS_MANAGE: 'config.settings.manage',
  /** The security log (A12). */
  SECURITY_VIEW: 'config.security.view',
  /** The audit trail (A13). */
  AUDIT_VIEW: 'config.audit.view',
} as const;

const P = CONFIG_PERMISSIONS;

/** Role → permissions. ADMIN holds every permission already; the Auditor reads (choice 7). */
export const CONFIG_ROLE_GRANTS: Record<string, string[]> = {
  [AUDITOR_ROLE]: [P.VIEW, P.SECURITY_VIEW, P.AUDIT_VIEW],
};

/** The Configuration catalogue: labels for the role editor (A09), and the grants above as the starter roles. */
export const CONFIG_PERMISSION_CATALOGUE: ModulePermissions = {
  module: 'config',
  label: 'Configuration',
  viewKey: P.VIEW,
  permissions: [
    { key: P.VIEW, object: 'Configuration', action: 'View' },
    { key: P.ORGANISATION_EDIT, object: 'Company and branch', action: 'Edit' },
    { key: P.USER_EDIT, object: 'User', action: 'Edit' },
    { key: P.ROLE_EDIT, object: 'Role', action: 'Edit' },
    { key: P.SETTINGS_MANAGE, object: 'Sign-in settings', action: 'Manage' },
    { key: P.SECURITY_VIEW, object: 'Security log', action: 'View' },
    { key: P.AUDIT_VIEW, object: 'Audit trail', action: 'View' },
  ],
  starterGrants: CONFIG_ROLE_GRANTS,
};
