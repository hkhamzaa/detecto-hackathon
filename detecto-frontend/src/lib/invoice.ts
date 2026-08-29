/**
 * What an invoice is, for both of the areas that show one.
 *
 * Two surfaces render invoices and they are not the same page: the platform's
 * tenant record in `lib/tenants/api.ts` shows an account's billing history to
 * Detecto's own staff, and `lib/subscription/api.ts` shows an organisation its
 * own. Neither imports the other — area isolation holds here the way it holds
 * everywhere else — so the shape they agree on lives out here instead, next to
 * `lib/plans.ts` and `lib/csv.ts` for the same reason.
 *
 * The alternative was two `Invoice` types drifting apart until a customer and a
 * support engineer read different words for the same unpaid bill, which is the
 * one conversation where that must not happen.
 *
 * Contract data only. Nothing here knows about a tenant or an organisation.
 */

export type InvoiceStatus = 'paid' | 'due' | 'failed'

export type Invoice = {
  id: string
  /** The period this invoice closed. */
  periodEnd: string
  amount: number
  status: InvoiceStatus
}

export const INVOICE_STATUSES: string[] = ['paid', 'due', 'failed']

/**
 * The state in a word, said the same way on both surfaces.
 *
 * "Due" rather than "Unpaid": an invoice inside its terms is not a problem, and
 * a customer opening their own billing page should not be told off for one that
 * has only just been issued.
 */
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Paid',
  due: 'Due',
  failed: 'Failed',
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABEL[status]
}

/** Anything not settled. Both pages lead with this rather than the full list. */
export function unpaid(invoices: Invoice[]): Invoice[] {
  return invoices.filter((invoice) => invoice.status !== 'paid')
}
