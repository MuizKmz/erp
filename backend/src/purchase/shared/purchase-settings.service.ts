import { Inject, Injectable } from '@nestjs/common';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ConfigurationError } from '../../platform/http/errors';
import { PrismaService } from '../../platform/prisma/prisma.service';
import type { PoLimitRule } from './approval-limit.rules';

/** Operation Policies (P24) as the Purchase services need them. */
@Injectable()
export class PurchaseSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
  ) {}

  async settings(tenantId: string) {
    const row = await this.prisma.purSetting.findUnique({ where: { tenantId } });
    if (!row) throw new ConfigurationError('Purchase settings are missing. Run the seed or open Approval Rules.');
    return row;
  }

  /** PO approval limits, with approver names from Master Data. */
  async poLimitRules(tenantId: string): Promise<PoLimitRule[]> {
    const [rules, users] = await Promise.all([
      this.prisma.purApprovalRule.findMany({ where: { tenantId, docType: 'PO', isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.masterData.listUsers(tenantId),
    ]);
    const name = (code: string | null) => (code ? (users.find((u) => u.code === code)?.name ?? code) : null);
    return rules.map((r) => ({
      branchCode: r.branchCode,
      thresholdAmount: r.thresholdAmount,
      approverRole: r.approverRole,
      approverCode: r.approverCode,
      approverName: name(r.approverCode),
      secondOverAmount: r.secondOverAmount,
      secondApproverRole: r.secondApproverRole,
      secondApproverCode: r.secondApproverCode,
      secondApproverName: name(r.secondApproverCode),
    }));
  }

  /** The approver for documents that go to one role "for all branches" (PI outside tolerance, PDN extra charge). */
  async ruleFor(tenantId: string, docType: 'PI' | 'PDN' | 'CP') {
    return this.prisma.purApprovalRule.findFirst({ where: { tenantId, docType, isActive: true }, orderBy: { sortOrder: 'asc' } });
  }
}
