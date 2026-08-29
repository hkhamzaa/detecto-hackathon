import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { CameraStatus } from '@/components/camera/camera-status'
import { NoCamerasYet } from '@/components/camera/no-cameras-yet'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { can } from '@/lib/auth/claims'
import type { Camera } from '@/lib/cameras/api'
import { useCameras } from '@/lib/cameras/queries'
import type { DetectionModule, ModuleConfig } from '@/lib/modules/api'
import { useModuleConfig } from '@/lib/modules/queries'
import { cn } from '@/lib/utils'
import { ModuleToggle } from '@/pages/org/modules/module-toggle'
import { ZoneBulk } from '@/pages/org/modules/zone-bulk'
import { useAuthStore } from '@/store/auth-store'

type ZoneGroup = { zone: string; label: string; cameras: Camera[] }

/** Zones alphabetically, with anything unzoned last — it is a loose end. */
function groupByZone(cameras: Camera[]): ZoneGroup[] {
  const groups = new Map<string, Camera[]>()
  for (const camera of cameras) {
    const zone = camera.zone.trim()
    groups.set(zone, [...(groups.get(zone) ?? []), camera])
  }

  return [...groups.entries()]
    .map(([zone, list]) => ({
      zone,
      label: zone || 'No zone set',
      cameras: list,
    }))
    .sort((a, b) => {
      if (!a.zone) return 1
      if (!b.zone) return -1
      return a.label.localeCompare(b.label)
    })
}

/**
 * Which detections run on which cameras.
 *
 * The route is already gated on `modules:manage`, so reaching this page means
 * holding the grant. The check is repeated against the controls anyway: it is
 * two lines, and it means the page stays correct if the route's gate is ever
 * widened.
 */
export default function OrgModulesPage() {
  const claims = useAuthStore((s) => s.claims)
  const canManage = can(claims, 'modules:manage')

  const cameras = useCameras()
  const config = useModuleConfig()

  const isPending = cameras.isPending || config.isPending
  const isError = cameras.isError || config.isError

  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Detection modules"
        lead="Which detections run on which cameras. Weapon detection on the entrance, violence detection in the yard — coverage is a choice you make camera by camera, not one switch for the whole site."
      />

      {!canManage && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-neutral-200 bg-paper-sunken px-4 py-3 text-meta text-neutral-600"
        >
          You don't have permission to change detection modules. Everything below
          is what is running today. An administrator in your organisation can
          change that.
        </p>
      )}

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable
          onRetry={() => {
            void cameras.refetch()
            void config.refetch()
          }}
          pending={cameras.isFetching || config.isFetching}
        />
      ) : cameras.data.length === 0 ? (
        <NoCamerasYet lead="Detection modules run on cameras, so there is nothing to configure here until you have connected some. Your Detecto Box connects to the recorder or cameras on your network and starts receiving the pictures they already produce." />
      ) : (
        <div className="grid gap-6">
          {groupByZone(cameras.data).map((group) => (
            <ZoneSection
              key={group.label}
              group={group}
              config={config.data}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Detection modules">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading your cameras and what runs on them…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load your modules" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that knows what runs where. Whatever
          was running is still running — this is the settings page, not the
          detection itself, and nothing has been switched off.
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

/* -------------------------------------------------------------------------- */
/* One zone                                                                   */
/* -------------------------------------------------------------------------- */

function ZoneSection({
  group,
  config,
  canManage,
}: {
  group: ZoneGroup
  config: ModuleConfig
  canManage: boolean
}) {
  const bulkId = useId()
  const [bulkOpen, setBulkOpen] = useState(false)

  const live = config.modules.filter((module) => module.status === 'live')
  // A bulk action needs a zone to scope to. Unzoned cameras are a group on this
  // page, not a place, so they are configured one at a time until someone gives
  // them a zone in camera settings.
  const canBulk = canManage && group.zone !== '' && live.length > 0

  return (
    <Panel
      label={group.label}
      action={
        <div className="flex items-center gap-3">
          <span className="label-micro text-neutral-500">
            {group.cameras.length}{' '}
            {group.cameras.length === 1 ? 'camera' : 'cameras'}
          </span>
          {canBulk && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={bulkOpen}
              aria-controls={bulkId}
              onClick={() => setBulkOpen((open) => !open)}
            >
              Apply to all
            </Button>
          )}
        </div>
      }
    >
      {canBulk && bulkOpen && (
        <ZoneBulk
          id={bulkId}
          zone={group.zone}
          cameraCount={group.cameras.length}
          modules={live}
          onClose={() => setBulkOpen(false)}
        />
      )}

      <ul className="divide-y divide-neutral-200">
        {group.cameras.map((camera) => (
          <CameraRow
            key={camera.id}
            camera={camera}
            modules={config.modules}
            enabled={
              config.cameras.find((entry) => entry.cameraId === camera.id)?.enabled ?? []
            }
            canManage={canManage}
          />
        ))}
      </ul>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* One camera                                                                 */
/* -------------------------------------------------------------------------- */

function CameraRow({
  camera,
  modules,
  enabled,
  canManage,
}: {
  camera: Camera
  modules: DetectionModule[]
  enabled: string[]
  canManage: boolean
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-start gap-3 px-5 py-4 text-left sm:px-6',
          'transition-colors duration-150 hover:bg-paper-sunken',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-neutral-400 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ink">
            {camera.name}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <CameraStatus online={camera.online} className="text-meta" />
            <RunningSummary enabled={enabled} modules={modules} />
          </span>
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="border-t border-neutral-200 bg-paper-sunken px-5 py-6 sm:px-6"
        >
          <ul className="grid gap-6">
            {modules.map((module) => (
              <ModuleToggle
                key={module.id}
                module={module}
                cameraId={camera.id}
                enabled={enabled.includes(module.id)}
                canManage={canManage}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

/**
 * A camera with nothing running is a camera watching nobody, so it says so in
 * Signal — the same reading the camera list gives an offline one. It is the
 * single most useful thing this page can surface without being opened.
 */
function RunningSummary({
  enabled,
  modules,
}: {
  enabled: string[]
  modules: DetectionModule[]
}) {
  if (enabled.length === 0) {
    return (
      <StatusWord tone="signal" className="text-meta">
        Nothing running
      </StatusWord>
    )
  }

  const names = enabled
    .map((id) => modules.find((module) => module.id === id)?.name)
    .filter((name): name is string => Boolean(name))

  return (
    <StatusWord tone="confirm" className="text-meta">
      {names.length === 1 ? names[0] : `${names[0]} + ${names.length - 1} more`}
    </StatusWord>
  )
}
