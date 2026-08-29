import { StatusWord } from '@/components/ui/status-word'
import type { Tenant } from '@/lib/tenants/api'
import { trialDaysLeft, trialIsEnding } from '@/lib/tenants/labels'

/**
 * An account's state, said in a word — the platform-side counterpart to
 * `AlertStatus` and `CameraStatus`.
 *
 * Follows the same restraint rule as every other status in the product: colour
 * the word only when something needs a person. An active account and an account
 * on trial are both simply facts. A suspension is a customer whose cameras are
 * being watched by nothing, and a trial running out in the next couple of days
 * is a conversation somebody needs to have this week — those two get Signal.
 */
export function TenantStatus({
  tenant,
  className,
}: {
  tenant: Pick<Tenant, 'status' | 'trialEndsAt'>
  className?: string
}) {
  if (tenant.status === 'suspended') {
    return (
      <StatusWord tone="signal" className={className}>
        Suspended
      </StatusWord>
    )
  }

  if (tenant.status === 'trial') {
    const left = trialDaysLeft(tenant)
    const ending = trialIsEnding(tenant)

    return (
      <StatusWord tone={ending ? 'signal' : 'neutral'} className={className}>
        {left === null
          ? 'Trial'
          : left <= 0
            ? 'Trial ended'
            : ending
              ? `Trial ends in ${left === 1 ? '1 day' : `${left} days`}`
              : 'Trial'}
      </StatusWord>
    )
  }

  return (
    <StatusWord tone="confirm" className={className}>
      Active
    </StatusWord>
  )
}
