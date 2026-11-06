import { Injectable, OnModuleInit } from '@nestjs/common';
import type { RequestContext } from '../platform/context/request-context';
import { toQty } from '../platform/http/decimal';
import { IndicatorRegistry } from '../platform/indicators/indicator.registry';
import type { IndicatorBoard, IndicatorResult } from '../platform/indicators/indicator.types';
import { WMS_PERMISSIONS as P } from './wms.permissions';
import { WmsQuery } from './wms.query';

const ALL = { page: 1, pageSize: 100_000 };
const TOP = 5;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The WMS home's charts, registered with the platform. Each reads the client's WMS when the home opens; a chart that
 * cannot be read shows its own message. Only a person's choice of charts is saved, in the ERP, as on the other homes.
 */
@Injectable()
export class WmsIndicators implements OnModuleInit {
  constructor(
    private readonly query: WmsQuery,
    private readonly registry: IndicatorRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.board());
  }

  private board(): IndicatorBoard {
    const view = P.VIEW;
    const toInventory = { label: 'View all', to: '/wms/inventory' };
    return {
      key: 'wms',
      defaults: { cols: 2, cards: ['wms.recent_receiving', 'wms.needs_attention', 'wms.units_by_warehouse'] },
      indicators: [
        {
          key: 'wms.recent_receiving', title: 'Recent receiving', description: 'The latest seven receivings, and how many tags are scanned in.',
          kind: 'table', wide: true, permission: view, link: { label: 'View all', to: '/wms/receiving' }, empty: 'No receivings yet.',
          compute: () => this.recentReceiving(),
        },
        {
          key: 'wms.needs_attention', title: 'Needs attention', description: 'Items out of stock, below their reorder level, or not in the ERP.',
          kind: 'list', permission: view, link: toInventory, empty: 'Every item is well stocked.',
          compute: (ctx) => this.needsAttention(ctx),
        },
        {
          key: 'wms.units_by_warehouse', title: 'Units by warehouse', description: 'How many units are on the shelves of each warehouse.',
          kind: 'bars', permission: view, link: { label: 'Stock location', to: '/wms/stock-location' }, empty: 'Nothing is on the shelves yet.',
          compute: (ctx) => this.unitsByWarehouse(ctx),
        },
        {
          key: 'wms.waiting_to_ship', title: 'Waiting to ship', description: 'Shipments the warehouse has not sent yet.',
          kind: 'list', permission: view, link: { label: 'View all', to: '/wms/shipping' }, empty: 'Nothing is waiting to ship.',
          compute: () => this.waitingToShip(),
        },
        {
          key: 'wms.top_items', title: 'Most units on hand', description: 'The five items with the most units on the shelves.',
          kind: 'bars', permission: view, link: toInventory, empty: 'Nothing is on the shelves yet.',
          compute: (ctx) => this.topItems(ctx),
        },
        {
          key: 'wms.units_by_group', title: 'Units by item group', description: 'How many units are on the shelves of each item group.',
          kind: 'bars', permission: view, link: toInventory, empty: 'Nothing is on the shelves yet.',
          compute: (ctx) => this.unitsByGroup(ctx),
        },
      ],
    };
  }

  private async recentReceiving(): Promise<IndicatorResult> {
    const { items } = await this.query.receiving({ page: 1, pageSize: 7 });
    return {
      data: {
        kind: 'table',
        columns: [
          { key: 'receiving', label: 'Receiving' },
          { key: 'po', label: 'PO' },
          { key: 'supplier', label: 'Supplier' },
          { key: 'scanned', label: 'Scanned in' },
          { key: 'status', label: 'Status' },
        ],
        rows: items.map((r) => ({
          id: r.id,
          cells: {
            receiving: { text: r.receivingCode, strong: true },
            po: { text: r.po ?? '—' },
            supplier: { text: r.supplierName ?? '—' },
            scanned: { progress: { done: toQty(r.scannedIn), of: toQty(r.received) } },
            status: { chip: { status: r.statusKey, label: r.statusLabel, group: r.statusGroup } },
          },
        })),
      },
    };
  }

  private async needsAttention(ctx: RequestContext): Promise<IndicatorResult> {
    const { items } = await this.query.inventory(ctx, ALL);
    const order = { OUT: 0, LOW: 1, NOT_IN_ERP: 2, IN_STOCK: 3 };
    const rows = items.filter((r) => r.state !== 'IN_STOCK').sort((a, b) => order[a.state] - order[b.state] || a.itemCode.localeCompare(b.itemCode));
    return {
      data: {
        kind: 'list',
        items: rows.slice(0, 7).map((r) => ({
          id: r.id,
          title: `${r.itemCode} · ${r.name}`,
          sub: r.reorderLevel === null ? plural(r.total, 'unit on hand', 'units on hand') : `${plural(r.total, 'unit', 'units')} on hand · reorder level ${Number(r.reorderLevel)}`,
          chip: { status: r.state, label: r.stateLabel, group: r.stateGroup },
          to: `/wms/inventory?q=${encodeURIComponent(r.itemCode)}`,
        })),
      },
    };
  }

  /** Largest first, without the zeros. */
  private bars(totals: Map<string, number>, limit?: number): IndicatorResult {
    const rows = [...totals.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { data: { kind: 'bars', unit: 'qty', rows: rows.slice(0, limit).map(([key, n]) => ({ key, label: key, value: toQty(n) })) } };
  }

  private async unitsByWarehouse(ctx: RequestContext): Promise<IndicatorResult> {
    const { totals } = await this.query.inventory(ctx, ALL);
    return this.bars(new Map(Object.entries(totals.byWarehouse)));
  }

  private async topItems(ctx: RequestContext): Promise<IndicatorResult> {
    const { items } = await this.query.inventory(ctx, ALL);
    return this.bars(new Map(items.map((r) => [r.itemCode, r.total])), TOP);
  }

  private async unitsByGroup(ctx: RequestContext): Promise<IndicatorResult> {
    const { items } = await this.query.inventory(ctx, ALL);
    const totals = new Map<string, number>();
    for (const r of items) totals.set(r.group, (totals.get(r.group) ?? 0) + r.total);
    return this.bars(totals);
  }

  private async waitingToShip(): Promise<IndicatorResult> {
    const { items } = await this.query.shipping({ ...ALL, status: 'pending' });
    return {
      data: {
        kind: 'list',
        items: items.slice(0, 7).map((s) => ({
          id: s.id,
          title: `${s.trackingCode} · ${s.order ?? '—'}`,
          sub: [s.customerName, s.destination].filter(Boolean).join(' · '),
          aside: plural(s.units, 'unit', 'units'),
          to: `/wms/shipping?q=${encodeURIComponent(s.trackingCode)}`,
        })),
      },
    };
  }
}
