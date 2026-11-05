import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort, type MdCustomer } from '../../master-data/master-data.port';

/** What the filter row of every Sales report offers (S05): branches, sales agents and customer groups. */
export interface ReportFilterOptions {
  branches: { code: string; name: string }[];
  agents: { code: string; name: string }[];
  groups: string[];
}

/**
 * The filter row the Sales reports share. Customers are read inside the person's request, so a report never offers
 * or counts a customer outside their data scope (RPT-020).
 */
@Injectable()
export class ReportFilters {
  constructor(@Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort) {}

  async load(tenantId: string): Promise<{ options: ReportFilterOptions; customers: MdCustomer[] }> {
    const [customers, users, branches] = await Promise.all([
      this.masterData.listCustomers(tenantId),
      this.masterData.listUsers(tenantId),
      this.masterData.listBranches(tenantId),
    ]);
    return {
      customers,
      options: {
        branches: branches.map((b) => ({ code: b.code, name: b.name })),
        agents: users.filter((u) => u.roles.includes('SALES_AGENT')).map((u) => ({ code: u.code, name: u.name })),
        groups: [...new Set(customers.map((c) => c.category).filter((c): c is string => Boolean(c)))].sort(),
      },
    };
  }
}

/** The customer codes in a customer group, or null when no group is picked (everyone). */
export function customersInGroup(customers: MdCustomer[], group?: string): Set<string> | null {
  return group ? new Set(customers.filter((c) => c.category === group).map((c) => c.code)) : null;
}

/** "2026-09" for each date, newest first, without repeats: the months a Period filter offers. */
export function periodsOf(dates: Date[], fallback: string): string[] {
  const months = [...new Set(dates.map((d) => d.toISOString().slice(0, 7)))].sort().reverse();
  return months.length ? months : [fallback];
}

export const day = (v: string) => new Date(`${v}T00:00:00.000Z`);
export const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
