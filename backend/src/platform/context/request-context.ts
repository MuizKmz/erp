import type { Request } from 'express';

/** The signed-in user. In dev mode this comes from the x-dev-user header; later from the JWT. */
export interface CurrentUserInfo {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  email: string;
  roles: string[];
  branchCodes: string[];
}

/** Everything a service needs to know about who is acting, where. Pass it into services; never read headers there. */
export interface RequestContext {
  tenantId: string;
  user: CurrentUserInfo;
  /** Branch the user is working in (x-branch header, else the user's first branch). */
  branchCode: string;
  /** Ties together the activity rows and events caused by one request. */
  correlationId: string;
}

export interface ErpRequest extends Request {
  context?: RequestContext;
}

/** Looks users up for the auth guard. Implemented by the Master Data adapter (users are master data). */
export interface UserDirectory {
  findUserByCode(tenantId: string, code: string): Promise<(CurrentUserInfo & { isActive: boolean }) | null>;
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
