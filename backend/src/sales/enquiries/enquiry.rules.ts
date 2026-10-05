/** Enquiry rules (FlowS1 steps 1–3, S06–S07). Pure functions. */
export const ENQ_STATUSES = ['NEW', 'FORWARDED', 'QUOTED', 'LOST'] as const;
export type EnqStatus = (typeof ENQ_STATUSES)[number];
export type EnqAction = 'edit' | 'delete' | 'forward' | 'createQuotation' | 'markLost';

export function allowedEnquiryActions(e: { status: EnqStatus; isMigrated: boolean; customerActive: boolean; hasQuotation: boolean; canEdit: boolean; canQuote: boolean }): EnqAction[] {
  if (e.isMigrated || !e.canEdit) return [];
  const actions: EnqAction[] = [];
  if (e.status === 'NEW' || e.status === 'FORWARDED') {
    actions.push('edit');
    if (e.status === 'NEW' && !e.hasQuotation) actions.push('delete', 'forward');
    if (e.customerActive && e.canQuote) actions.push('createQuotation');
    actions.push('markLost');
  }
  return actions;
}
