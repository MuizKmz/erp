import type { Request } from 'express';

/** The signed-in user: from the x-dev-user header in dev mode, from the access token in sign-in mode. */
export interface CurrentUserInfo {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  email: string;
  roles: string[];
  branchCodes: string[];
  department: string | null;
  jobTitle: string | null;
}

/** Everything a service needs to know about who is acting, where. Pass it into services; never read headers there. */
export interface RequestContext {
  tenantId: string;
  user: CurrentUserInfo;
  /** Branch the user is working in: the token's active branch (jwt), the x-branch header (dev), else the default branch. */
  branchCode: string;
  /** Ties together the activity rows and events caused by one request. */
  correlationId: string;
  /** The signed-in session (AUTH_MODE=jwt); absent in dev mode and for the system. */
  sessionId?: string;
}

export interface ErpRequest extends Request {
  context?: RequestContext;
}

/** Looks users up for the auth guards. Implemented by the Master Data adapter, which reads what Configuration keeps. */
export interface UserDirectory {
  findUserByCode(tenantId: string, code: string): Promise<(CurrentUserInfo & { isActive: boolean }) | null>;
  listUsers(tenantId: string): Promise<(CurrentUserInfo & { isActive: boolean; department: string | null })[]>;
  /** Branch names, for the top bar's branch switch. */
  listBranches(tenantId: string): Promise<{ code: string; name: string; isActive: boolean }[]>;
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
