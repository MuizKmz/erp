/** Entity types on Configuration's sys_activity rows and events. */
export const CONFIG_ENTITY = {
  LEGAL_ENTITY: 'SYS_LEGAL_ENTITY',
  BRANCH: 'SYS_BRANCH',
  USER: 'SYS_USER',
  ROLE: 'SYS_ROLE',
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

/** What sys_security_event rows record (NFR-SEC-012). Sign-in events come with A5. */
export const SECURITY_EVENT = {
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
