/** Which of a user's role and branch assignments count (Configuration keeps them in sys_user_role, sys_user_branch). Pure. */
/** A role a user holds, as Configuration keeps it. Both dates are inclusive; empty means no limit. */
export interface RoleAssignment {
  code: string;
  validFrom: Date | null;
  validUntil: Date | null;
}

/** The roles that give permissions on the day, in the order they were given: an expired one stops the day after its last day. */
export function rolesOn(assignments: RoleAssignment[], on: Date): string[] {
  return assignments
    .filter((a) => (!a.validFrom || a.validFrom.getTime() <= on.getTime()) && (!a.validUntil || a.validUntil.getTime() >= on.getTime()))
    .map((a) => a.code);
}

/** The user's branch codes, the default branch first (the active branch when no other is picked), then by code. */
export function branchCodesInOrder(links: { code: string; isDefault: boolean }[]): string[] {
  return [...links].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code)).map((l) => l.code);
}
