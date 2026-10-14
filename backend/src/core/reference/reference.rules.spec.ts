import { creditTermName, daysChangeError, lookAlikeWarning, referenceDeleteRefusal, renameError, usedByText } from './reference.rules';

describe('reference list rules', () => {
  it('says who uses an entry', () => {
    expect(usedByText({ items: 1 })).toBe('1 item');
    expect(usedByText({ customers: 6, suppliers: 10 })).toBe('6 customers · 10 suppliers');
    expect(usedByText({ customers: 0 })).toBe('Not used');
    expect(creditTermName(0)).toBe('Cash');
    expect(creditTermName(60)).toBe('60 days');
  });

  it('changes a name only while nothing uses it; a credit term keeps its days instead', () => {
    expect(renameError('item-groups', 'Sofas', { items: 0 })).toBeNull();
    expect(renameError('item-groups', 'Sofas', { items: 2 })).toBe(
      '“Sofas” is used by 2 items, so its name cannot change. Add the new name, move them to it, then make “Sofas” inactive.',
    );
    expect(renameError('credit-terms', '30 days', { customers: 6 })).toBeNull();
    expect(daysChangeError('30 days', { customers: 6, suppliers: 10 })).toBe('30 days is used by 6 customers · 10 suppliers, so its days cannot change. Add a new credit term instead.');
    expect(daysChangeError('60 days', {})).toBeNull();
  });

  it('deletes only an entry nothing uses', () => {
    expect(referenceDeleteRefusal('Northern', { customers: 0 })).toBeNull();
    expect(referenceDeleteRefusal('Northern', { customers: 2 })).toBe('“Northern” is used by 2 customers, so it cannot be deleted. Make it inactive instead.');
  });

  it('names look-alike groups and the items to move', () => {
    const groups = [
      { name: 'Seating', items: ['CH-DIN-01'] },
      { name: 'Service', items: ['SV-INS-01', 'SV-REP-01', 'SV-SET-01'] },
      { name: 'Services', items: ['SV-DEL-01'] },
    ];
    expect(lookAlikeWarning(groups)).toBe(
      '“Service” and “Services” look like the same group. Moving SV-DEL-01 to “Service” would leave one: change the group on the item, then make “Services” inactive.',
    );
    expect(lookAlikeWarning(groups.slice(0, 2))).toBeNull();
    expect(lookAlikeWarning([{ name: 'Table', items: ['TB-1'] }, { name: 'Tables', items: [] }])).toBe('“Table” and “Tables” look like the same group. One of them is not used and can be deleted.');
  });
});
