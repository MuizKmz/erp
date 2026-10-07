import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { ConfigurationError } from '../../platform/http/errors';
import type { Tx } from '../../platform/prisma/prisma.service';

const VARIABLE = /\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}/g;

/** A date as it reads in an email: 21 Oct 2026. */
export function mailDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
}

/** Fills {document.number}-style fields. Unknown fields stay as written, so a typo shows in the preview. */
export function renderSalesTemplate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(VARIABLE, (whole, name: string) => vars[name] ?? whole);
}

export interface SalesMail {
  templateKey: string;
  entityType: string;
  entityId: string;
  docNo: string;
  to: string;
  agentEmail?: string | null;
  vars: Record<string, string | null | undefined>;
}

/**
 * Sales emails (S33 templates). Phase 1 does not send mail: the rendered email is written to sys_email_log in the
 * same transaction and the screen shows "Sent". Logged with template key "SALES_<key>".
 */
@Injectable()
export class SalesMailService {
  constructor(private readonly clock: ClockService) {}

  async send(tx: Tx, ctx: RequestContext, mail: SalesMail): Promise<{ to: string } | null> {
    const template = await tx.salEmailTemplate.findUnique({ where: { tenantId_key: { tenantId: ctx.tenantId, key: mail.templateKey } } });
    if (!template) throw new ConfigurationError(`Email template ${mail.templateKey} is missing. Add it in Email Templates.`);
    if (!template.isActive) return null;
    const tenant = await tx.sysTenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const vars = { 'company.name': tenant?.name ?? '', ...mail.vars };
    await tx.sysEmailLog.create({
      data: {
        tenantId: ctx.tenantId, entityType: mail.entityType, entityId: mail.entityId, docNo: mail.docNo, templateKey: `SALES_${template.key}`,
        toAddress: mail.to, ccAddress: template.copyAgent ? (mail.agentEmail ?? null) : null,
        subject: renderSalesTemplate(template.subject, vars), body: renderSalesTemplate(template.body, vars),
        sentByCode: ctx.user.code, createdAt: this.clock.now(),
      },
    });
    return { to: mail.to };
  }
}
