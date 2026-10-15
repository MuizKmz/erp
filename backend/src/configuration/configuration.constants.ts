/** Entity types on Configuration's sys_activity rows and events. */
export const CONFIG_ENTITY = {
  LEGAL_ENTITY: 'SYS_LEGAL_ENTITY',
  BRANCH: 'SYS_BRANCH',
} as const;
export type ConfigEntityType = (typeof CONFIG_ENTITY)[keyof typeof CONFIG_ENTITY];

/** Events Configuration publishes (CLAUDE.md → Phase 4 · Events Configuration publishes). No module listens yet. */
export const CONFIG_EVENT = {
  LEGAL_ENTITY_UPDATED: 'config.legal_entity.updated',
  BRANCH_UPDATED: 'config.branch.updated',
} as const;

/** Base currencies by code, for the company form (read only: currencies come with Finance). */
export const CURRENCY_NAME: Record<string, string> = {
  MYR: 'Ringgit Malaysia',
};
