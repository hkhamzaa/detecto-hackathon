/**
 * The pairing code shown on the box: eight characters, written in two blocks of
 * four so it can be read off a screen and typed without losing your place.
 *
 * Normalising is deliberately limited to case and separators. Folding
 * look-alikes — `O` onto `0`, or `I` onto `1` — is tempting and wrong: it can
 * only be done safely by whichever side generates the alphabet, and doing it
 * here would quietly rewrite characters that were typed correctly.
 */

export const PAIRING_CODE_LENGTH = 8

function normalise(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, PAIRING_CODE_LENGTH)
}

/** Keeps the field in `XXXX-XXXX` shape while it is being typed. */
export function formatPairingCode(value: string) {
  const clean = normalise(value)
  return clean.length <= 4 ? clean : `${clean.slice(0, 4)}-${clean.slice(4)}`
}

/** What gets sent: eight characters, no separator. */
export function pairingCodeValue(value: string) {
  return normalise(value)
}

export function isCompletePairingCode(value: string) {
  return normalise(value).length === PAIRING_CODE_LENGTH
}
