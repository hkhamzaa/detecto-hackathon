import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { useAlerts } from '@/lib/alerts/queries'
import { can } from '@/lib/auth/claims'
import type { Camera } from '@/lib/cameras/api'
import { useCameras } from '@/lib/cameras/queries'
import type { NotificationSettings } from '@/lib/notifications/api'
import { useNotificationSettings } from '@/lib/notifications/queries'
import { useModuleConfig } from '@/lib/modules/queries'
import type { Directory } from '@/lib/roles/api'
import { useDirectory } from '@/lib/roles/queries'
import { ChannelsSection } from '@/pages/org/settings/notifications/channels'
import { EscalationSection } from '@/pages/org/settings/notifications/escalation'
import { RouteRow } from '@/pages/org/settings/notifications/route-row'
import { useAuthStore } from '@/store/auth-store'

/**
 * Who is told when a detection is raised, and what happens if nobody looks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL ON THIS PAGE
 *
 * The routing decisions are real and sit on data that already exists: zones come
 * from the cameras this organisation has connected, detection types come from
 * the module catalogue, and every recipient is a person holding a role built on
 * the People page. Nothing here is a separate contact list — see the header of
 * `lib/notifications/routing.ts` for why that matters more than it sounds.
 *
 * Delivery does not exist. Detecto has no push registration, no mail sender and
 * no telephony, so nothing on this page sends anything today. That is said at
 * the top of the page in those words, because a settings screen that looks like
 * it is working is worse than one that is honestly empty.
 *
 * PERMISSION
 *
 * `org:settings`, the grant that already gates this area and whose own
 * description in `lib/roles/permissions.ts` reads "Sites and zones, notification
 * routes, and escalation contacts". It fits exactly; no new key was invented.
 * The route is gated on it already, so the check is repeated against the
 * controls rather than the page — the same arrangement `/org/modules` and
 * `/org/users` use, and for the same reason: it keeps the page correct if that
 * gate is ever widened.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function OrgNotificationsPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'org:settings')

  const settings = useNotificationSettings()
  const directory = useDirectory()
  const cameras = useCameras()
  const config = useModuleConfig()
  // Only to show what an escalation threshold would have caught. A failure here
  // costs a helpful line, not the page.
  const alerts = useAlerts()

  const pending =
    settings.isPending || directory.isPending || cameras.isPending || config.isPending
  const failed = settings.isError || directory.isError

  const retry = () => {
    void settings.refetch()
    void directory.refetch()
    void cameras.refetch()
    void config.refetch()
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Alert notifications"
        lead="Who is told when a detection is raised, and what happens if nobody reviews it. Everyone here is somebody who already holds a role in your organisation — this is not a separate contact list."
        action={
          <Button asChild size="sm" variant="ghost">
            <Link to="/org/settings">
              <ArrowLeft />
              Settings
            </Link>
          </Button>
        }
      />

      <NotDelivering />

      {!canManage && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-neutral-200 bg-paper-sunken px-4 py-3 text-meta text-neutral-600"
        >
          You don't have permission to change notification settings. Everything
          below is how your organisation is routed today. An administrator can
          change that.
        </p>
      )}

      {pending ? (
        <Loading />
      ) : failed ? (
        <Unavailable
          onRetry={retry}
          pending={settings.isFetching || directory.isFetching}
        />
      ) : (
        <Sections
          settings={settings.data}
          directory={directory.data}
          cameras={cameras.isSuccess ? cameras.data : []}
          modules={
            config.isSuccess
              ? config.data.modules
                  .filter((module) => module.status === 'live')
                  .map((module) => ({ id: module.id, name: module.name, detail: module.description }))
              : []
          }
          alerts={alerts.isSuccess ? alerts.data : null}
          // As of when the queue was read, not as of this render.
          now={alerts.dataUpdatedAt}
          canManage={canManage}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* The sections                                                               */
/* -------------------------------------------------------------------------- */

function Sections({
  settings,
  directory,
  cameras,
  modules,
  alerts,
  now,
  canManage,
}: {
  settings: NotificationSettings
  directory: Directory
  cameras: Camera[]
  modules: { id: string; name: string; detail: string }[]
  alerts: Parameters<typeof EscalationSection>[0]['alerts']
  now: number
  canManage: boolean
}) {
  const { roles, people } = directory
  const zones = zonesFrom(cameras)

  const routeFor = (kind: 'zone' | 'module', target: string) =>
    settings.routes.find((route) => route.kind === kind && route.target === target)

  return (
    <>
      <ChannelsSection
        routes={settings.routes}
        roles={roles}
        people={people}
        zones={zones.map((zone) => zone.name)}
        modules={modules}
      />

      <Panel label="By zone" className="mb-6">
        <PanelBody className="border-b border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-600">
            Anything raised in a zone, whatever detected it. By default everyone
            whose role reaches the zone is told; narrow one when a team should
            hear about their own area and not the rest of the site.
          </p>
        </PanelBody>

        {zones.length === 0 ? (
          <PanelBody>
            <p className="max-w-2xl text-body text-neutral-700">
              Your cameras have no zones yet, so there is nothing to route by
              place. Zones are set when a camera is connected, and every camera
              in one can be routed together once they are.
            </p>
          </PanelBody>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {zones.map((zone) => (
              <RouteRow
                key={zone.name}
                kind="zone"
                target={zone.name}
                label={zone.name}
                detail={`${zone.cameras} ${zone.cameras === 1 ? 'camera' : 'cameras'}`}
                route={routeFor('zone', zone.name)}
                roles={roles}
                people={people}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="By detection type" className="mb-6">
        <PanelBody className="border-b border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-600">
            One kind of detection, wherever it is found. A detection type is not
            a place, so narrowing one does not limit it to a zone — the people
            you pick hear about it across everything their role already reaches.
          </p>
        </PanelBody>

        {modules.length === 0 ? (
          <PanelBody>
            <p className="max-w-2xl text-body text-neutral-700">
              No detection module is live, so nothing can be raised to route.
            </p>
          </PanelBody>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {modules.map((module) => (
              <RouteRow
                key={module.id}
                kind="module"
                target={module.id}
                label={module.name}
                detail={module.detail}
                route={routeFor('module', module.id)}
                roles={roles}
                people={people}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="When both apply" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            A weapon found in the yard matches a zone route and a detection-type
            route at once. Everybody named by{' '}
            <strong className="font-medium text-ink">either</strong> is told —
            never only the people named by both. Two separately sensible
            narrowings that happened not to overlap would otherwise combine into
            an alert nobody hears about, and on this product that is the one
            outcome that must not be reachable by accident. Telling one person
            more than necessary is the cheaper mistake, so it is the one Detecto
            makes.
          </p>
          <p className="mt-3 max-w-2xl text-meta text-neutral-600">
            What routing cannot do is widen somebody's access. A role limited to
            certain zones is only ever notified about those zones, whoever names
            it — being told about an alert you are not allowed to open would be
            worse than not being told at all. Access is set with the role, on the
            People page.
          </p>
        </PanelBody>
      </Panel>

      <EscalationSection
        policy={settings.escalation}
        roles={roles}
        people={people}
        alerts={alerts}
        now={now}
        canManage={canManage}
      />

      <Gaps />

      <p className="max-w-2xl text-meta text-neutral-500">
        Everything on this page notifies people inside your organisation.
        Detecto does not contact the police, a guard company or any emergency
        service — not on a detection, not on a confirmation, and not when an
        alert has been waiting a long time. That is a call a person makes.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Zones                                                                      */
/* -------------------------------------------------------------------------- */

type ZoneCount = { name: string; cameras: number }

/**
 * Zones as the cameras report them, alphabetically.
 *
 * Unzoned cameras are left out rather than grouped: `/org/modules` can show
 * them as a heading because a module runs on a camera, but a routing rule needs
 * a zone to be keyed on, and `""` is not one. A camera with no zone is still
 * covered — it is reached by the detection-type routes, and by any role whose
 * scope is every camera.
 */
function zonesFrom(cameras: Camera[]): ZoneCount[] {
  const counts = new Map<string, number>()
  for (const camera of cameras) {
    const zone = camera.zone.trim()
    if (!zone) continue
    counts.set(zone, (counts.get(zone) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([name, cameras]) => ({ name, cameras }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* -------------------------------------------------------------------------- */
/* What is not built                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The statement that has to come before any of the settings.
 *
 * Placed above the controls rather than in the gaps panel at the bottom,
 * because it changes how everything below should be read. An administrator who
 * narrows the yard route and walks away believing the yard team is now being
 * paged has been misled by this page, and no footnote further down would have
 * prevented it.
 */
function NotDelivering() {
  return (
    <div className="mb-6 rounded-md border border-neutral-300 bg-paper-sunken px-4 py-3.5">
      <p className="max-w-2xl text-meta text-neutral-700">
        <strong className="font-medium text-ink">
          Detecto does not send these notifications yet.
        </strong>{' '}
        The app has no push registration and nothing sends email, so no alert has
        ever reached anybody through the routes below. What this page decides is
        real and is stored — who <em>would</em> be told, and when — and it will
        be honoured the day delivery is built. Until then, the alert queue is
        how people find out.
      </p>
    </div>
  )
}

/**
 * Three gaps, stated where somebody would go looking for them.
 *
 * Per-person channels are the one worth reading twice, and the reason is
 * concrete rather than a matter of taste: there is no field. See the header of
 * `channels.tsx` — a `Person` has no channel preference, no consent record and
 * no telephone number, and a switch that writes to none of those is the same
 * lie told with a checkbox that `lib/roles/permissions.ts` refuses about
 * `cameras:manage`.
 */
function Gaps() {
  return (
    <Panel label="Not built" className="mb-6">
      <PanelBody>
        <ul className="grid max-w-2xl gap-4">
          <li>
            <h3 className="text-meta font-medium text-ink">
              Nothing is delivered yet
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              There is no push registration in the app, no mail sender, and no
              telephony. The routing above is stored and is the decision Detecto
              will act on; it has never caused a notification, and nothing on
              this page will send a test one, because there is nothing to send
              it with.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No per-person channel choice
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Push in the app is the only channel, and it is the same for
              everybody. A person record holds a name, an email address and a
              role — no channel preference, no consent record, and no telephone
              number — so email and SMS have nowhere to be configured and SMS
              has no number to reach. Which sender or which SMS provider is
              backend infrastructure and would not be decided here even once it
              exists.
            </p>
          </li>

          <li>
            <h3 className="text-meta font-medium text-ink">
              No quiet hours, and no per-person schedule
            </h3>
            <p className="mt-1 text-meta text-neutral-600">
              Routing is by place and by detection type only. Who is on shift at
              three in the morning is a rota, nothing in Detecto holds one, and a
              time window that silenced a weapon detection would be a setting
              worth being very sure about before offering it.
            </p>
          </li>
        </ul>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Alert notifications">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your zones, roles and routing…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your notification settings" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds who is notified. Nothing
          has changed — this is the settings page, and it has not written
          anything. Detection is still running, and alerts are still arriving in
          the queue.
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
