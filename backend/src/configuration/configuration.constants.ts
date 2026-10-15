/** Entity types on Configuration's sys_activity rows and events. */
export const CONFIG_ENTITY = {
  LEGAL_ENTITY: 'SYS_LEGAL_ENTITY',
  BRANCH: 'SYS_BRANCH',
  USER: 'SYS_USER',
  ROLE: 'SYS_ROLE',
  SETTING: 'SYS_SETTING',
} as const;
export type ConfigEntityType = (typeof CONFIG_ENTITY)[keyof typeof CONFIG_ENTITY];

/** Events Configuration publishes (CLAUDE.md → Phase 4 · Events Configuration publishes). No module listens yet. */
export const CONFIG_EVENT = {
  LEGAL_ENTITY_UPDATED: 'config.legal_entity.updated',
  BRANCH_UPDATED: 'config.branch.updated',
  USER_CREATED: 'config.user.created',
  USER_UPDATED: 'config.user.updated',
  ROLE_UPDATED: 'config.role.updated',
} as const;

/** What sys_security_event rows record (NFR-SEC-012). */
export const SECURITY_EVENT = {
  SIGNED_IN: 'SIGNED_IN',
  SIGN_IN_FAILED: 'SIGN_IN_FAILED',
  LOCKED_OUT: 'LOCKED_OUT',
  SIGNED_OUT: 'SIGNED_OUT',
  SESSION_ENDED: 'SESSION_ENDED',
  TOKEN_REUSED: 'TOKEN_REUSED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_SET: 'PASSWORD_SET',
  RESET_REQUESTED: 'RESET_REQUESTED',
  LINK_SENT: 'LINK_SENT',
  TWO_FACTOR_ON: 'TWO_FACTOR_ON',
  TWO_FACTOR_OFF: 'TWO_FACTOR_OFF',
  TWO_FACTOR_RESET: 'TWO_FACTOR_RESET',
  RECOVERY_CODE_USED: 'RECOVERY_CODE_USED',
  UNLOCKED: 'UNLOCKED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  USER_CREATED: 'USER_CREATED',
  ROLES_CHANGED: 'ROLES_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  ROLE_CHANGED: 'ROLE_CHANGED',
} as const;

/** Base currencies by code, for the company form (read only: currencies come with Finance). */
export const CURRENCY_NAME: Record<string, string> = {
  MYR: 'Ringgit Malaysia',
};
