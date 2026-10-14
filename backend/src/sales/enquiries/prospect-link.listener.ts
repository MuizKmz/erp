import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ActivityService } from '../../platform/activity/activity.service';
import type { RequestContext } from '../../platform/context/request-context';
import { OutboxConsumers } from '../../platform/outbox/outbox.consumers';
import type { OutboxEnvelope } from '../../platform/outbox/outbox.types';
import type { Tx } from '../../platform/prisma/prisma.service';
import { SAL_ENTITY } from '../shared/sales.constants';
import { linkDecision, readCustomerCreated } from './prospect-link.rules';

/** The Core event Sales listens to (EVENTS.md). The name is Core's; Sales never imports Core code. */
export const CUSTOMER_CREATED_EVENT = 'mdm.customer.created';
/** Listener name, stored in sys_event_handled. */
export const PROSPECT_LINK_LISTENER = 'sales.prospect-link';

const SYSTEM = { code: 'SYSTEM', name: 'System' } as const;

/**
 * Prospect → customer (decision 7, FlowS1 step 2). When Core creates a customer from an enquiry, the enquiry gets that
 * customer, so "Create quotation" works. The enquiry's version goes up, so a form still open on the old version is
 * asked to reload rather than putting the prospect back.
 */
@Injectable()
export class SalesProspectLinkListener implements OnModuleInit {
  private readonly logger = new Logger(SalesProspectLinkListener.name);

  constructor(
    private readonly consumers: OutboxConsumers,
    private readonly activity: ActivityService,
  ) {}

  onModuleInit(): void {
    this.consumers.listen(CUSTOMER_CREATED_EVENT, PROSPECT_LINK_LISTENER, (e, tx) => this.onCustomerCreated(e, tx));
  }

  async onCustomerCreated(event: OutboxEnvelope, tx: Tx): Promise<void> {
    const customer = readCustomerCreated(event.aggregateId, event.payload);
    if (!customer) return; // most new customers do not come from an enquiry
    const enquiry = await tx.salEnquiry.findFirst({ where: { tenantId: event.tenantId, docNo: customer.enquiryNo } });
    const decision = linkDecision(enquiry, customer);
    if (decision === 'missing') {
      this.logger.warn(`${event.name} ${event.id}: customer ${customer.code} names enquiry ${customer.enquiryNo}, which Sales does not have; nothing linked`);
      return;
    }
    if (decision === 'same' || !enquiry) return;
    const log = (action: string, message: string) =>
      this.activity.log(tx, this.ctx(event), { entityType: SAL_ENTITY.ENQUIRY, entityId: enquiry.id, docNo: enquiry.docNo, action, message });
    if (decision === 'other') {
      await log('prospect_not_linked', `Master Data customer ${customer.code} names this enquiry, but it is already for ${enquiry.customerCode}. Nothing changed.`);
      return;
    }
    await tx.salEnquiry.update({
      where: { id: enquiry.id },
      data: { customerId: customer.customerId, customerCode: customer.code, customerName: customer.name, version: { increment: 1 }, updatedBy: SYSTEM.code },
    });
    await log('prospect_linked', `${enquiry.customerName} was added to Master Data as ${customer.code} · ${customer.name}. Quotations can now be made.`);
  }

  private ctx(event: OutboxEnvelope): RequestContext {
    return {
      tenantId: event.tenantId,
      branchCode: '',
      correlationId: event.correlationId,
      user: { id: SYSTEM.code, tenantId: event.tenantId, code: SYSTEM.code, name: SYSTEM.name, email: '', roles: [], branchCodes: [], department: null, jobTitle: null },
    };
  }
}
