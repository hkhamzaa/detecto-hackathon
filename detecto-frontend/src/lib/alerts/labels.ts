import type { Alert, AlertStatus, DetectionKind } from '@/lib/alerts/api'

/** How an alert reads to a person. Display only — nothing decides anything here. */

const KIND_LABEL: Record<DetectionKind, string> = {
  weapon: 'Weapon',
  violence: 'Violence',
}

const STATUS_LABEL: Record<AlertStatus, string> = {
  // "Awaiting human" rather than "Pending": what it is waiting for is the point.
  unconfirmed: 'Awaiting human',
  confirmed: 'Confirmed',
  dismissed: 'False positive',
}

export function statusLabel(status: AlertStatus) {
  return STATUS_LABEL[status]
}

/** `Weapon · handgun`, or just `Weapon` when the model only had the class. */
export function detectionLabel(alert: Pick<Alert, 'kind' | 'subtype'>) {
  const kind = KIND_LABEL[alert.kind]
  return alert.subtype ? `${kind} · ${alert.subtype}` : kind
}

/** The heading on the confirmation card. */
export function detectionHeadline(alert: Pick<Alert, 'kind'>) {
  return alert.kind === 'weapon' ? 'Weapon detected' : 'Violence detected'
}

/** Two decimals, always — a score that reads `0.6` hides whether it was 0.62. */
export function confidenceLabel(confidence: number) {
  return confidence.toFixed(2)
}
