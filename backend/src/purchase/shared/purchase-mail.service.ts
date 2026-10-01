import { Injectable } from '@nestjs/common';
import { ClockService } from '../../platform/clock/clock.service';
import type { RequestContext } from '../../platform/context/request-context';
import { ConfigurationError } from '../../platform/http/errors';
import type { Tx } from '../../platform/prisma/prisma.service';
import { renderTemplate, type TemplateVariables } from './email-template.rules';

export interface MailToSend {
  templateKey: string;
  vars: TemplateVariables;
  entityType: string;
  entityId: string;
  docNo: string;
}

/**
 * Purchase emails. Phase 1 does not send mail: the rendered email is written to sys_email_log in the same
 * transaction and the UI shows "Sent". Templates come from Email Templates (P26).
 */
@Injectable()
export class PurchaseMailService {
  constructor(private readonly clock: ClockService) {}

  /** Renders and logs an email. Returns the recipient, or null when the template is switched off. */
  async send(tx: Tx, ctx: RequestContext, mail: MailToSend): Promise<{ to: string; autoSend: boolean } | null> {
    const template = await tx.purEmailTemplate.findUnique({
      where: { tenantId_key: { tenantId: ctx.tenantId, key: mail.templateKey } },
    });
    if (!template) throw new ConfigurationError(`Email template ${mail.templateKey} is missing. Add it in Email Templates.`);
    if (!template.isActive) return null;

    const vars: TemplateVariables = { 'company.name': await this.companyName(tx, ctx), ...mail.vars };
    const to = renderTemplate(template.toTemplate, vars);
    await tx.sysEmailLog.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: mail.entityType,
        entityId: mail.entityId,
        docNo: mail.docNo,
        templateKey: template.key,
        toAddress: to,
        ccAddress: template.ccTemplate ? renderTemplate(template.ccTemplate, vars) : null,
        subject: renderTemplate(template.subject, vars),
        body: renderTemplate(template.body, vars),
        sentByCode: ctx.user.code,
        createdAt: this.clock.now(),
      },
    });
    return { to, autoSend: template.autoSend };
  }

  /** Does this template send by itself (e.g. "Send automatically on release")? */
  async isAutoSend(tx: Tx, ctx: RequestContext, templateKey: string): Promise<boolean> {
    const template = await tx.purEmailTemplate.findUnique({ where: { tenantId_key: { tenantId: ctx.tenantId, key: templateKey } } });
    return Boolean(template?.isActive && template.autoSend);
  }

  private async companyName(tx: Tx, ctx: RequestContext): Promise<string> {
    const tenant = await tx.sysTenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    return tenant?.name ?? '';
  }
}
