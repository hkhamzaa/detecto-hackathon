export type Errors<T extends string> = Partial<Record<T, string>>

/**
 * Moves focus to the first control the browser has marked invalid, so a failed
 * submit lands the user on the thing that needs changing rather than leaving
 * them to hunt for it.
 */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]')
  target?.focus()
}

export function countIssues(errors: Errors<string>) {
  return Object.values(errors).filter(Boolean).length
}

/** Plain, non-apologetic summary announced to assistive tech on failed submit. */
export function issueSummary(errors: Errors<string>) {
  const n = countIssues(errors)
  if (n === 0) return ''
  return n === 1
    ? 'One field needs a change before you can continue.'
    : `${n} fields need a change before you can continue.`
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

/**
 * The only password rule the product actually has.
 *
 * Ten characters, checked in the browser. That is the whole policy — there is
 * no complexity requirement, no rotation, no reuse history and no breach check
 * anywhere in the claims system or the auth transport, and the security
 * settings page says so rather than listing rules nothing enforces.
 *
 * It lives here rather than in the signup step that first needed it, because
 * three surfaces now ask the same question — signup, changing your own
 * password, and the security page that reports what the rule is — and three
 * copies of a number is how they come to disagree.
 */
export const MIN_PASSWORD = 10

/** The message for a password that is too short, or `undefined` when it is fine. */
export function passwordIssue(value: string): string | undefined {
  if (!value) return 'Create a password.'
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters. This one has ${value.length}.`
  }
  return undefined
}

/** At least seven digits, ignoring how somebody chose to punctuate it. */
export function isPhone(value: string) {
  return digits(value).length >= 7
}

export function digits(value: string) {
  return value.replace(/\D/g, '')
}

/** Groups a card number into fours as it is typed. */
export function formatCardNumber(value: string) {
  return digits(value).slice(0, 19).replace(/(.{4})/g, '$1 ').trim()
}

/** Keeps an expiry field in MM/YY shape while typing. */
export function formatExpiry(value: string) {
  const d = digits(value).slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`
}

/** True when MM/YY is a real month that has not already passed. */
export function isFutureExpiry(value: string, now = new Date()) {
  const match = /^(\d{2})\/(\d{2})$/.exec(value)
  if (!match) return false
  const month = Number(match[1])
  const year = 2000 + Number(match[2])
  if (month < 1 || month > 12) return false
  const endOfMonth = new Date(year, month, 1)
  return endOfMonth > now
}
