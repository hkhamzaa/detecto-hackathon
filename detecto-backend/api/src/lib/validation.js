/**
 * Mirrors detecto-frontend/src/lib/forms.ts exactly, so a password or email
 * the browser already accepted never gets refused server-side, and the
 * numbers this quotes back don't drift from the ones the signup page prints.
 */

export const MIN_PASSWORD = 10;

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value ?? '').trim());
}

export function passwordIssue(value) {
  if (!value) return 'Create a password.';
  if (value.length < MIN_PASSWORD) {
    return `Use at least ${MIN_PASSWORD} characters. This one has ${value.length}.`;
  }
  return undefined;
}

export function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function isPhone(value) {
  return digits(value).length >= 7;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before any id-based lookup so a malformed path param gets a plain
 * 400 instead of surfacing Postgres's `invalid_text_representation` error
 * as an opaque 500.
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}
