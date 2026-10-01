/**
 * Email templates use single braces: "Dear {supplier.contact}, please find {po.number} …".
 * Unknown variables are left as written, so a typo is visible in the preview instead of silently empty.
 */
const VARIABLE = /\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\}/g;

export type TemplateVariables = Record<string, string | null | undefined>;

export function renderTemplate(text: string, vars: TemplateVariables): string {
  return text.replace(VARIABLE, (whole, name: string) => {
    const value = vars[name];
    return value === null || value === undefined ? whole : value;
  });
}

/** Variable names a template uses, for the "Fields you can use" check. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1] as string))];
}
