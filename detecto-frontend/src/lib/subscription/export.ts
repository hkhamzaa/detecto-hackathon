import { csvFilename, saveCsv, toCsv } from '@/lib/csv'
import { invoiceStatusLabel, type Invoice } from '@/lib/invoice'
import { planById } from '@/lib/plans'

/**
 * An organisation's own invoice list, as a file their finance team can open.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A LIST OF INVOICES IS NOT AN INVOICE
 *
 * This writes the rows on screen: what was billed, for which period, and
 * whether it was paid. It is for reconciling against a bank statement, and it
 * is genuinely useful for that.
 *
 * It is not a tax document. A real invoice is a PDF with Detecto's company
 * details, a VAT number, an invoice date and a total that somebody's accountant
 * can file — none of which this browser has or should be inventing. That is a
 * server-side document, and the page says so rather than letting a CSV stand in
 * for one.
 *
 * The same provenance problem the analytics and audit exports have applies:
 * this is built client-side from what the page was sent, so it carries no
 * signature and can be edited before anybody passes it on.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The field quoting and the formula-injection guard come from `lib/csv.ts`,
 * shared with every other export in the product. A plan name lands in the same
 * spreadsheet as everything else and needs the same guard.
 */

const COLUMNS = ['invoice_id', 'period_end', 'plan', 'amount', 'status'] as const

export function buildInvoiceCsv(invoices: Invoice[], planId: string): string {
  const plan = planById(planId)

  return toCsv([
    [...COLUMNS],
    ...invoices.map((invoice) => [
      invoice.id,
      invoice.periodEnd,
      // The plan as this build names it. An id the catalogue does not know is
      // written out as-is rather than blanked — the same reading `planLabel`
      // takes, because an unrecognised plan is worth seeing.
      plan?.name ?? planId,
      invoice.amount,
      invoiceStatusLabel(invoice.status),
    ]),
  ])
}

/** `detecto-invoices-2026-08-27.csv`. */
export function invoiceFilename(now = new Date()): string {
  return csvFilename('invoices', now)
}

export function downloadInvoiceCsv(
  invoices: Invoice[],
  planId: string,
  filename = invoiceFilename(),
): void {
  saveCsv(buildInvoiceCsv(invoices, planId), filename)
}
