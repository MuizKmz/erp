/**
 * Export to Excel as a CSV file (SRS RPT-025): numbers stay numbers (left unquoted), everything else is quoted text.
 * The byte-order mark makes Excel read it as UTF-8, so "·" and "–" come through.
 */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    return typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(text) ? text : `"${text.replace(/"/g, '""')}"`
  }
  const csv = rows.map((row) => row.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
