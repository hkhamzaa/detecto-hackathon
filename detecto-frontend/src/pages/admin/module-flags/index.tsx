import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { can } from '@/lib/auth/claims'
import { useModuleFlags } from '@/lib/module-flags/queries'
import { useTenants } from '@/lib/tenants/queries'
import { ModuleRow } from '@/pages/admin/module-flags/module-row'
import { useAuthStore } from '@/store/auth-store'

/**
 * What exists, and who is entitled to it.
 *
 * The platform-level counterpart to an organisation's own modules page, and not
 * the same control. An org admin decides which of the modules available to them
 * runs on which camera. This decides what is available to them in the first
 * place — whether a module exists at all, and which plans include it.
 *
 * Boundary, as on every platform surface: plan, tier and module configuration
 * only. Nothing here knows which cameras have a module enabled, and it does not
 * need to. That is per-camera state, it belongs to the organisation that owns
 * the camera, and it is reached with that organisation's own session. See the
 * note at the top of `lib/module-flags/api.ts`.
 */
export default function AdminModuleFlagsPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:modules')

  const flags = useModuleFlags()
  // Only to say how many accounts a change reaches. Counts, from the registry
  // this area already holds.
  const tenants = useTenants()

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="Module flags" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              This is a Detecto platform surface, and your account doesn't hold
              the grant for it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Module flags"
        lead="Which detection modules exist, and which plans include them. An organisation chooses what runs on which camera; this decides what they are offered in the first place."
      />

      {flags.isPending ? (
        <Loading />
      ) : flags.isError ? (
        <Unavailable
          onRetry={() => {
            void flags.refetch()
            void tenants.refetch()
          }}
          pending={flags.isFetching}
        />
      ) : (
        <>
          <Panel label="Module registry" className="mb-6">
            <PanelBody className="border-b border-neutral-200 py-4">
              <p className="max-w-2xl text-meta text-neutral-600">
                Releasing a module makes it available to every organisation on a
                plan that includes it. None of them are watched for it until
                somebody there switches it on, camera by camera.
              </p>
            </PanelBody>

            <ul className="divide-y divide-neutral-200">
              {flags.data.map((module) => (
                <ModuleRow
                  key={module.id}
                  module={module}
                  // An unreachable registry means the reach of a change is
                  // unknown. It reads as zero organisations rather than as a
                  // guess, and the confirm step says so plainly.
                  tenants={tenants.isSuccess ? tenants.data : []}
                />
              ))}
            </ul>
          </Panel>

          <Gaps />
        </>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* What this page does not do yet                                             */
/* -------------------------------------------------------------------------- */

/**
 * Two honest gaps, stated on the page rather than left for somebody to discover
 * by trusting a control that does not do what it looks like it does.
 *
 * This follows the precedent set for `cameras:manage` in
 * `lib/roles/permissions.ts`: when a capability has no backing, the product
 * says so in the place a person would go looking for it, rather than shipping
 * an affordance that quietly changes nothing.
 *
 * STAGED ROLLOUT is absent for a concrete reason, not an aesthetic one.
 * Enabling a newly-live module for a handful of organisations first needs a
 * tenant-by-module allowlist, and no such linkage exists: `Tenant` has no module
 * field and `ModuleConfig` has no tenant field. More decisively, the endpoint
 * that would have to honour it does not consult anything of the sort —
 * `getModuleConfig()` returns the whole catalogue to every caller and gates only
 * on `status`. A rollout picker built today would record selections that nothing
 * reads, which is worse than not having one.
 */
function Gaps() {
  return (
    <Panel label="Not wired up yet">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              Plan tiers are authored here, not yet enforced
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The org-side module endpoint returns the whole catalogue to
              everybody and checks only whether a module is live — it never sees
              the caller's plan. Until it filters on plan, the tiers above are a
              statement of intent. Do not quote them to a customer as an
              entitlement.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No staged rollout
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Releasing to a few organisations before everyone would need a
              record of which organisations, and nothing in the data model holds
              one. Rather than build a picker whose choices nothing reads, a
              release here goes to every organisation on an included plan at
              once. Withdrawing is one click away if it goes badly.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              Plan catalogue is placeholder
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              The plans above come from the same provisional catalogue the
              signup flow uses — the names, the ceilings and the pricing are all
              unsigned-off. Which tier a module belongs on is a guess until they
              are settled.
            </p>
          </li>
        </ul>

        <p className="mt-6 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
          This page governs availability, never per-camera state. Which cameras
          are running a module belongs to the organisation that owns them, and no
          platform surface opens it.
        </p>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Module registry">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading the module registry…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load the module registry" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds the module registry.
          Nothing has been released or withdrawn, and every organisation is being
          offered exactly what it was a minute ago — this is the settings page,
          not the detection itself.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={onRetry}
          disabled={pending}
        >
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}
