import { renderTemplate, templateVariables } from './email-template.rules';

describe('renderTemplate', () => {
  it('fills single-brace variables', () => {
    expect(
      renderTemplate('Please find our purchase order {po.number} dated {po.date}.', {
        'po.number': 'PO-0001',
        'po.date': '23 Sep 2026',
      }),
    ).toBe('Please find our purchase order PO-0001 dated 23 Sep 2026.');
  });

  it('leaves unknown or empty variables visible', () => {
    expect(renderTemplate('Dear {supplier.contact}, {po.nmber}', { 'supplier.contact': null })).toBe(
      'Dear {supplier.contact}, {po.nmber}',
    );
  });

  it('does not touch braces that are not variables', () => {
    expect(renderTemplate('Total {RM} { po.number }', { 'po.number': 'X' })).toBe('Total {RM} { po.number }');
  });
});

describe('templateVariables', () => {
  it('lists each variable once', () => {
    expect(templateVariables('{po.number} {po.total} {po.number}')).toEqual(['po.number', 'po.total']);
  });
});
