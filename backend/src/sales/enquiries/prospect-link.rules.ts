/**
 * Prospect → customer (CLAUDE.md → Phase 3, decision 7; FlowS1 step 2): when Core creates a customer from an enquiry,
 * Sales links that enquiry to the new customer so it can be quoted. Pure functions.
 */
import { isRecord, text } from '../../platform/outbox/outbox.payload';

export interface CustomerCreated {
  customerId: string;
  code: string;
  name: string;
  enquiryNo: string;
}

/** The parts of `mdm.customer.created` Sales needs. Null when the customer did not come from an enquiry. */
export function readCustomerCreated(aggregateId: string, payload: unknown): CustomerCreated | null {
  if (!isRecord(payload)) return null;
  const code = text(payload.code);
  const enquiryNo = text(payload.enquiryNo);
  const name = isRecord(payload.snapshot) ? text(payload.snapshot.name) : null;
  if (!code || !enquiryNo || !name) return null;
  return { customerId: aggregateId, code, name, enquiryNo };
}

export type LinkDecision = 'link' | 'missing' | 'same' | 'other';

/** Link only an enquiry that has no customer yet; leave one that already has this or another customer. */
export function linkDecision(enquiry: { customerCode: string | null } | null, customer: CustomerCreated): LinkDecision {
  if (!enquiry) return 'missing';
  if (!enquiry.customerCode) return 'link';
  return enquiry.customerCode === customer.code ? 'same' : 'other';
}
