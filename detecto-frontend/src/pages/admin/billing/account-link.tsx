import { Link } from 'react-router-dom'

/**
 * An account name, linked to its record when there still is one.
 *
 * The plan change log names cancelled accounts, and a cancelled account has
 * left the registry — a link to it would be a dead end dressed up as a next
 * step. Those names render as plain text, which is also the honest signal that
 * there is nothing left to open.
 *
 * Never a link into the organisation's own area. `/admin/tenants/:id` is a
 * platform record of how an account is configured and billed; it is not a way
 * into their cameras, and no billing surface opens one.
 */
export function AccountLink({
  id,
  name,
  known,
}: {
  id: string
  name: string
  /** Whether the account is still in the tenant registry. */
  known: boolean
}) {
  if (!known) {
    return <span className="font-medium text-neutral-600">{name}</span>
  }

  return (
    <Link
      to={`/admin/tenants/${id}`}
      className="font-medium text-ink underline decoration-neutral-300 underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {name}
    </Link>
  )
}
