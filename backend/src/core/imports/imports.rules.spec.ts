import { checkSummary, duplicateOf, loadSummary, matchColumns, parseAmount, parseCsv, parseDate, parseYesNo, updateText } from './imports.rules';

describe('import rules', () => {
  it('reads CSV with quotes, commas, line breaks, CRLF and a byte-order mark', () => {
    const text = '﻿Code,Name,Address\r\nC-0012,"Hotel Seri Bayu Sdn Bhd","Jalan 1, Shah Alam"\r\n,"Kedai ""Baru""","Line one\nline two"\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['Code', 'Name', 'Address'],
      ['C-0012', 'Hotel Seri Bayu Sdn Bhd', 'Jalan 1, Shah Alam'],
      ['', 'Kedai "Baru"', 'Line one\nline two'],
    ]);
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('matches headers whatever their case or signs, and names the unused and missing ones', () => {
    const columns = [
      { key: 'code', header: 'Code' },
      { key: 'priceList', header: 'Price list', aliases: ['Price list code'] },
      { key: 'item', header: 'Item' },
    ];
    const m = matchColumns(['CODE', 'price_list_code', 'Colour'], columns, ['item']);
    expect([...m.index.entries()]).toEqual([
      ['code', 0],
      ['priceList', 1],
    ]);
    expect(m.unused).toEqual(['Colour']);
    expect(m.missing).toEqual(['Item']);
  });

  it('reads yes/no, dates day first, and amounts with commas', () => {
    expect([parseYesNo('Yes'), parseYesNo('n'), parseYesNo(''), parseYesNo('maybe')]).toEqual([true, false, null, undefined]);
    expect(parseDate('2026-11-01')).toBe('2026-11-01');
    expect(parseDate('1/11/2026')).toBe('2026-11-01');
    expect(parseDate('1 Nov 2026')).toBe('2026-11-01');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('next week')).toBeNull();
    expect(parseAmount('RM 40,000.00')).toBe('40000.00');
    expect(parseAmount('150000')).toBe('150000');
    expect(parseAmount('12,5')).toBe('12,5');
  });

  it('finds the earlier row with the same key', () => {
    expect(duplicateOf(['C-0012', null, 'C-0045', 'C-0012', null])).toEqual([null, null, null, 0, null]);
  });

  it('says what an update changes and sums up a check and a load', () => {
    expect(updateText([{ label: 'Phone' }])).toBe('Update: phone');
    expect(updateText([{ label: 'TIN' }, { label: 'ID number' }])).toBe('Update: TIN and ID number');
    expect(updateText([{ label: 'Phone' }, { label: 'Email' }, { label: 'Area' }, { label: 'Name' }])).toBe('Update: phone, email and 2 more');
    expect(checkSummary({ ready: 2, unchanged: 0, problem: 1 })).toBe(
      '2 rows are ready and 1 has a problem. Load saves the 2 ready rows, each on its own. The row with a problem is left out: download it, fix it and upload it again.',
    );
    expect(checkSummary({ ready: 1, unchanged: 2, problem: 0 })).toBe('1 row is ready. 2 rows change nothing and are left out. Load saves the ready row.');
    expect(loadSummary({ added: 1, updated: 1, unchanged: 0, problem: 1 })).toBe(
      '2 rows saved: 1 added, 1 updated. 1 row with a problem was left out: download it, fix it and upload it again.',
    );
  });
});
