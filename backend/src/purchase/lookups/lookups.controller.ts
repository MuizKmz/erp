import { Controller, Get, Inject, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { MASTER_DATA_PORT, type MasterDataPort } from '../../master-data/master-data.port';
import { ClockService } from '../../platform/clock/clock.service';
import { CurrentContext, RequirePermission } from '../../platform/context/context.decorators';
import type { RequestContext } from '../../platform/context/request-context';
import { toPrice } from '../../platform/http/decimal';
import { DemandService } from '../demand/demand.service';
import { PURCHASE_PERMISSIONS } from '../purchase.permissions';
import { PUR_ROLE } from '../shared/purchase.constants';

class LookupQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplierCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  role?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  warehouseCode?: string;
}

/**
 * Lists for pickers and filters (MasterDataPicker). Codes are always picked from these, never typed.
 * Purchase rules apply here: only active suppliers, only purchasable items.
 */
@Controller('purchase/lookups')
@RequirePermission(PURCHASE_PERMISSIONS.VIEW)
export class LookupsController {
  constructor(
    @Inject(MASTER_DATA_PORT) private readonly masterData: MasterDataPort,
    private readonly demand: DemandService,
    private readonly clock: ClockService,
  ) {}

  @Get('suppliers')
  async suppliers(@CurrentContext() ctx: RequestContext, @Query() query: LookupQuery) {
    const rows = await this.masterData.searchSuppliers(ctx.tenantId, { q: query.q, activeOnly: true, limit: 20 });
    return {
      items: rows.map((s) => ({
        code: s.code,
        name: s.name,
        shortName: s.shortName,
        email: s.email,
        paymentTermDays: s.paymentTermDays,
        currency: s.currency,
        isWalkIn: s.isWalkIn,
      })),
    };
  }

  @Get('items')
  async items(@CurrentContext() ctx: RequestContext, @Query() query: LookupQuery) {
    const [items, taxes, suppliers] = await Promise.all([
      this.masterData.searchPurchasableItems(ctx.tenantId, { q: query.q, limit: 20 }),
      this.masterData.listTaxCodes(ctx.tenantId),
      this.masterData.listSuppliers(ctx.tenantId),
    ]);
    const codes = items.map((i) => i.code);
    const [lastPrices, contracts] = await Promise.all([
      this.demand.lastPrices(ctx.tenantId, codes),
      query.supplierCode
        ? this.masterData.listContractPrices(ctx.tenantId, { supplierCode: query.supplierCode, itemCodes: codes, onDate: this.clock.today() })
        : Promise.resolve([]),
    ]);
    return {
      items: items.map((i) => {
        const tax = taxes.find((t) => t.code === i.purchaseTaxCode);
        const last = lastPrices.get(i.code);
        return {
          code: i.code,
          name: i.name,
          type: i.type,
          uomCode: i.uomCode,
          taxCode: i.purchaseTaxCode,
          taxName: tax?.name ?? i.purchaseTaxCode,
          taxRate: tax?.rate ?? '0.0000',
          preferredSupplierCode: i.preferredSupplierCode,
          preferredSupplierName: suppliers.find((s) => s.code === i.preferredSupplierCode)?.name ?? null,
          lastPrice: last ? toPrice(last) : null,
          contractPrice: contracts.find((c) => c.itemCode === i.code)?.unitPrice ?? null,
        };
      }),
    };
  }

  @Get('warehouses')
  async warehouses(@CurrentContext() ctx: RequestContext) {
    const [warehouses, branches] = await Promise.all([this.masterData.listWarehouses(ctx.tenantId), this.masterData.listBranches(ctx.tenantId)]);
    // Only warehouses of branches the user works in.
    return {
      items: warehouses
        .filter((w) => w.isActive && ctx.user.branchCodes.includes(w.branchCode))
        .map((w) => ({ ...w, branchName: branches.find((b) => b.code === w.branchCode)?.name ?? w.branchCode })),
    };
  }

  /** Put-away locations (racks) of a warehouse, for goods receipts. */
  @Get('locations')
  async locations(@CurrentContext() ctx: RequestContext, @Query() query: LookupQuery) {
    return { items: (await this.masterData.listLocations(ctx.tenantId, query.warehouseCode)).filter((l) => l.isActive) };
  }

  @Get('branches')
  async branches(@CurrentContext() ctx: RequestContext) {
    return { items: (await this.masterData.listBranches(ctx.tenantId)).filter((b) => b.isActive) };
  }

  /** People with a role (approver picker in "Send for approval", buyer filter on lists). */
  @Get('users')
  async users(@CurrentContext() ctx: RequestContext, @Query() query: LookupQuery) {
    const role = query.role ?? PUR_ROLE.BUYER;
    const users = await this.masterData.listUsers(ctx.tenantId);
    return {
      items: users
        .filter((u) => u.isActive && u.roles.includes(role))
        .filter((u) => !query.branchCode || u.branchCodes.includes(query.branchCode))
        .map((u) => ({ code: u.code, name: u.name, email: u.email, roles: u.roles })),
    };
  }
}
