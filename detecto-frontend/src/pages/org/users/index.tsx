import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { can } from '@/lib/auth/claims'
import { useDirectory } from '@/lib/roles/queries'
import { PeopleList } from '@/pages/org/users/people-list'
import { RoleList } from '@/pages/org/users/role-list'
import { useAuthStore } from '@/store/auth-store'

/**
 * People, and the roles they hold.
 *
 * Roles come first on the page because they are what the people list refers to.
 * Somebody arriving to invite a colleague has to decide what that colleague can
 * do before the invite means anything, and the role summaries above are where
 * that decision is legible.
 *
 * The route is already gated on `users:manage`. The check is repeated against
 * the controls so the page stays correct if that gate is ever widened.
 */
export default function OrgUsersPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'users:manage')

  const { data: directory, isPending, isError, refetch, isFetching } = useDirectory()

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="People"
        lead="Who can see your cameras, who can confirm a detection, and who can change how any of it works. Access is built from a checklist rather than picked from fixed tiers — Detecto does not know what your team looks like."
      />

      {!canManage && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-neutral-200 bg-paper-sunken px-4 py-3 text-meta text-neutral-600"
        >
          You don't have permission to change people or roles. Everything below
          is how your organisation is set up today. An administrator can change
          that.
        </p>
      )}

      {isPending ? (
        <Panel label="People and roles">
          <PanelBody>
            <p role="status" aria-live="polite" className="text-meta text-neutral-500">
              Loading your people and roles…
            </p>
          </PanelBody>
        </Panel>
      ) : isError ? (
        <Panel label="Can't load your people" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              Detecto couldn't reach the service that knows who is in your
              organisation. Nobody's access has changed — this is the settings
              page, and it has not written anything.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-5"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? 'Trying again…' : 'Try again'}
            </Button>
          </PanelBody>
        </Panel>
      ) : (
        <div className="grid gap-6">
          <RoleList
            roles={directory.roles}
            people={directory.people}
            canManage={canManage}
          />
          <PeopleList
            people={directory.people}
            roles={directory.roles}
            canManage={canManage}
          />
        </div>
      )}
    </>
  )
}
