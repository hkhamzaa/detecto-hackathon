/**
 * Writing a CSV somebody outside Detecto will open.
 *
 * Lifted out of `lib/analytics/export.ts` when the audit log needed the same
 * thing. The formula-injection guard below is the reason this is shared rather
 * than written twice: it is a security control, and a second implementation is
 * a second thing to get wrong — quietly, in the file a customer hands to an
 * auditor, which is the worst place to find out.
 *
 * What is *in* an export stays with the feature that owns it. This module knows
 * how to write a field, a row and a file; it knows nothing about alerts or audit
 * entries.
 */

/**
 * One CSV field.
 *
 * The leading apostrophe on anything a spreadsheet would treat as a formula is
 * not decoration. Camera names, zones and role names are typed by customers,
 * and a zone called `=cmd|...` in a file opened by an auditor in Excel is a
 * well-known way to run code on their machine. Quoting alone does not stop it.
 */
export function csvField(value: string | number | null): string {
  if (value === null) return ''

  const text = String(value)
  const risky = /^[=+\-@\t\r]/.test(text)
  const escaped = risky ? `'${text}` : text

  // Risky fields are quoted as well as prefixed, so the apostrophe survives
  // readers that only unescape inside quotes. Everything else is quoted only
  // when it has to be.
  return risky || /[",\n\r]/.test(escaped)
    ? `"${escaped.replace(/"/g, '""')}"`
    : escaped
}

export function csvRow(values: (string | number | null)[]): string {
  return values.map(csvField).join(',')
}

/**
 * Rows to a file, header included by the caller.
 *
 * CRLF: the line ending the CSV spec asks for, and the one the spreadsheet
 * these are opened in expects.
 */
export function toCsv(rows: (string | number | null)[][]): string {
  return `${rows.map(csvRow).join('\r\n')}\r\n`
}

/** `detecto-alerts-2026-08-27.csv` — dated, so two exports never collide. */
export function csvFilename(name: string, now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  return `detecto-${name}-${stamp}.csv`
}

/**
 * Hands the file to the browser. The BOM is there so Excel opens a name with an
 * accent in it correctly instead of showing mojibake to the person being asked
 * to trust the contents.
 */
export function saveCsv(csv: string, filename: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()

  // Released on the next tick; revoking it synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
