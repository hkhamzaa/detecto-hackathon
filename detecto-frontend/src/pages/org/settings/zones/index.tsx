import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/app-shell/page-header'
import { NoCamerasYet } from '@/components/camera/no-cameras-yet'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { can } from '@/lib/auth/claims'
import { useCameras } from '@/lib/cameras/queries'
import { useNotificationSettings } from '@/lib/notifications/queries'
import { useDirectory } from '@/lib/roles/queries'
import {
  orphanedZones,
  referencesFor,
  zonesInUse,
} from '@/lib/zones/references'
import { BackToSettings } from '@/pages/org/settings/profile'
import { OrphanedZones, ZoneRow } from '@/pages/org/settings/zones/zone-row'
import { useAuthStore } from '@/store/auth-store'

/**
 * The zones an organisation actually has, and the two things worth doing to
 * them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ZONES ARE NOT CREATED HERE, AND THERE IS NO "ADD ZONE" BUTTON
 *
 * A zone exists because a camera is in it. That is not a limitation of this
 * page — it is what a zone *is* in this product: a name on a camera, which
 * roles and notification routes then point at. A zone with no cameras is not an
 * empty place waiting to be filled, it is a name nothing raises an alert under,
 * and creating one would mean offering somebody a role scope and a routing
 * target that can never match anything.
 *
 * So zones are made by assigning a camera to one — in the connection wizard, or
 * by editing a camera — and this page manages the ones that exist. That was the
 * open question left by the camera wizard, which has been treating zones as
 * free text since it was built, and this is the answer.
 *
 * WHAT THIS PAGE READS, AND WHY IT READS THREE THINGS
 *
 * Cameras, roles and notification routes, because those are the three stores a
 * zone name is written into and there is no fourth. Everything shown is worked
 * out from them by the pure helpers in `lib/zones/references.ts`; nothing here
 * is fetched from a zone endpoint, because there is no zone record to fetch.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgZonesPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'org:settings')

  const cameras = useCameras()
  const directory = useDirectory()
  const settings = useNotificationSettings()

  /*
   * Only the cameras gate the page. They are what makes a zone exist; roles and
   * routes add references to count, and waiting on all three would leave
   * somebody staring at a spinner because their notification settings were slow.
   *
   * Anything short of all three arriving — still loading, or unreachable — is
   * `incomplete`, which shows the counts as understated and withdraws both
   * actions rather than letting somebody agree to a merge on a partial picture.
   */
  const pending = cameras.isPending
  const failed = cameras.isError

  const retry = () => {
    void cameras.refetch()
    void directory.refetch()
    void settings.refetch()
  }

  return (
    <>
      <BackToSettings />

      <PageHeader
        eyebrow="Organisation · Settings"
        title="Zones"
        lead="The places your cameras are in. A zone is what an alert names, what a role is held to, and what notifications are routed by — so the same word has to mean the same place in all three."
      />

      {pending ? (
        <Loading />
      ) : failed ? (
        <Unavailable onRetry={retry} pending={cameras.isFetching} />
      ) : (
        <Zones
          cameras={cameras.data}
          roles={directory.isSuccess ? directory.data.roles : []}
          routes={settings.isSuccess ? settings.data.routes : []}
          incomplete={!directory.isSuccess || !settings.isSuccess}
          canManage={canManage}
        />
      )}
    </>
  )
}

function Zones({
  cameras,
  roles,
  routes,
  incomplete,
  canManage,
}: {
  cameras: Parameters<typeof zonesInUse>[0]
  roles: Parameters<typeof orphanedZones>[1]
  routes: Parameters<typeof orphanedZones>[2]
  /** True when roles or routes could not be read, so counts are understated. */
  incomplete: boolean
  canManage: boolean
}) {
  if (cameras.length === 0) {
    return (
      <NoCamerasYet lead="Zones come from the cameras that are in them, so there are none to manage until some cameras are connected. A zone is set when a camera is added, and every camera in one can be routed and scoped together afterwards." />
    )
  }

  const zones = zonesInUse(cameras)
  const orphans = orphanedZones(cameras, roles, routes)
  const unzoned = cameras.filter((camera) => !camera.zone.trim())

  return (
    <>
      {incomplete && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-signal-500/40 bg-signal-50 px-4 py-3 text-meta text-signal-700"
        >
          Detecto couldn't reach your roles or your notification routing, so the
          counts below only include cameras. Renaming or merging a zone from
          here would still rewrite every reference — but you would be agreeing to
          it without being shown what it touches, so both are unavailable until
          this page can read all three.
        </p>
      )}

      <Panel label="Zones in use" className="mb-6">
        <PanelBody className="border-b border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-600">
            Renaming rewrites the name on every camera, role and notification
            route that uses it, in one change — nobody's access moves. Merging
            two zones does move access, and says whose before it happens.
          </p>
        </PanelBody>

        {zones.length === 0 ? (
          <PanelBody>
            <p className="max-w-2xl text-body text-neutral-700">
              None of your cameras have a zone yet. Give one a zone and it
              appears here.
            </p>
          </PanelBody>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {zones.map((zone) => (
              <ZoneRow
                key={zone}
                references={referencesFor(zone, cameras, roles, routes)}
                zones={zones}
                cameras={cameras}
                roles={roles}
                routes={routes}
                canManage={canManage && !incomplete}
              />
            ))}
          </ul>
        )}
      </Panel>

      {unzoned.length > 0 && (
        <Panel label="Cameras with no zone" className="mb-6">
          <PanelBody>
            <p className="max-w-2xl text-body text-neutral-700">
              {unzoned.length === 1 ? '1 camera is' : `${unzoned.length} cameras are`}{' '}
              not in any zone: {unzoned.map((camera) => camera.name).join(', ')}.
            </p>
            <p className="mt-3 max-w-2xl text-meta text-neutral-600">
              They are still watched, and alerts from them still reach anybody
              whose role covers every camera. What they miss is anything routed
              or scoped by place — a role held to certain zones will not reach
              them, and a zone notification route will not cover them. Set a zone
              on the camera to fix it.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to="/org/cameras">Go to cameras</Link>
            </Button>
          </PanelBody>
        </Panel>
      )}

      {orphans.length > 0 && (
        <Panel label="Names nothing is in" tone="signal" className="mb-6">
          <PanelBody className="border-b border-neutral-200 py-4">
            <p className="max-w-2xl text-meta text-neutral-600">
              A role or a notification route still names these, and no camera is
              in them. They are not zones — they are references left behind when
              the last camera moved out, and anything held to one reaches
              nothing.
            </p>
          </PanelBody>
          <PanelBody>
            <OrphanedZones zones={orphans} roles={roles} routes={routes} />
          </PanelBody>
        </Panel>
      )}

      <Panel label="How zones work here" className="mb-6">
        <PanelBody>
          <ul className="grid max-w-2xl gap-4">
            <li>
              <h3 className="text-meta font-medium text-ink">
                A zone is a name, not a record
              </h3>
              <p className="mt-1 text-meta text-neutral-600">
                There is no zone object anywhere in Detecto and no zone id. The
                same words are written onto each camera, into the roles held to
                that place, and into the notification route keyed on it. That is
                why renaming is one change made in one go rather than a field
                edit — a rename that reached the cameras and missed the roles
                would leave people holding access to a zone that no longer
                exists, which quietly reaches nothing.
              </p>
            </li>

            <li>
              <h3 className="text-meta font-medium text-ink">
                Zones are created by assigning a camera
              </h3>
              <p className="mt-1 text-meta text-neutral-600">
                There is no "add zone" here on purpose. An empty zone is a name
                nothing can be raised under, and it would offer a role scope and
                a routing target that could never match anything. Name a zone
                when you connect a camera, or by editing one.
              </p>
            </li>

            <li>
              <h3 className="text-meta font-medium text-ink">
                History keeps the old name
              </h3>
              <p className="mt-1 text-meta text-neutral-600">
                Detections already raised, and the audit log, keep whatever the
                zone was called at the time. Those are records of what happened,
                and rewriting them to match the present is exactly what a record
                must not do — so a rename changes the configuration and leaves
                the history alone.
              </p>
            </li>
          </ul>
        </PanelBody>
      </Panel>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Zones">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Working out your zones…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your zones" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Zones are worked out from your cameras, and Detecto couldn't reach the
          camera list. Nothing has changed — this is the settings page, and it
          has not written anything. Your cameras are unaffected.
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
