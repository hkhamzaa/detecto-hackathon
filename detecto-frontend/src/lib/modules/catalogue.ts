/**
 * The detection-module contract, and the seed catalogue behind it.
 *
 * Split out of `api.ts` so that the two surfaces which need it — an
 * organisation's own module page and the platform's module registry — can each
 * import it without dragging in the other's transport. `api.ts` reaches for
 * `lib/cameras/api` to build an org's per-camera config; a platform page must
 * never pull that into its bundle, and this file is what keeps it from having
 * to.
 *
 * Contract data only. Nothing here knows about a camera or an organisation.
 */

/** The contract's `module_status`, verbatim. */
export type ModuleStatus = 'live' | 'coming_soon'

export type DetectionModule = {
  id: string
  name: string
  /** What it looks for, in the customer's words. */
  description: string
  status: ModuleStatus
  /**
   * 0–1, measured. Null for anything not `live` — a module that has never run
   * has no rate, and showing a plausible-looking one would be a fabrication.
   */
  falsePositiveRate: number | null
  /** One honest line about what running it costs, when there is one to give. */
  resourceNote: string | null
}

/**
 * The catalogue as the contract currently freezes it: two live, four on the
 * roadmap. The roadmap ones are here on purpose — a customer deciding whether
 * Detecto covers what they need should see what is coming, clearly marked as
 * not here yet.
 *
 * Exported, and deliberately mutable, so the platform's module-flags mock can
 * write to the same records this one reads. In production `module_status` is a
 * single column that one surface sets and the other reads; two independent mock
 * stores would let a demo show a module live on the platform page and coming
 * soon on the org page, which is precisely the thing the flags page exists to
 * control. Both are dev mocks and are deleted together.
 */
export const MOCK_CATALOGUE: DetectionModule[] = [
  {
    id: 'weapon',
    name: 'Weapon detection',
    description: 'Firearms and firearm-shaped objects in view of the camera.',
    status: 'live',
    falsePositiveRate: 0.04,
    resourceNote: null,
  },
  {
    id: 'violence',
    name: 'Violence detection',
    description: 'Fights, struggles and sustained physical altercations.',
    status: 'live',
    falsePositiveRate: 0.07,
    resourceNote:
      'Heavier than weapon detection. On a box carrying eight or more cameras, flags from this one can take a few seconds longer to arrive.',
  },
  {
    id: 'loitering',
    name: 'Loitering',
    description: 'Someone staying in one spot for longer than a place expects.',
    status: 'coming_soon',
    falsePositiveRate: null,
    resourceNote: null,
  },
  {
    id: 'zone_intrusion',
    name: 'Zone intrusion',
    description: 'Someone entering an area that should be empty, or off-limits at that hour.',
    status: 'coming_soon',
    falsePositiveRate: null,
    resourceNote: null,
  },
  {
    id: 'theft',
    name: 'Theft',
    description: 'Items leaving a space they are not meant to leave.',
    status: 'coming_soon',
    falsePositiveRate: null,
    resourceNote: null,
  },
  {
    id: 'forced_movement',
    name: 'Forced movement',
    description: 'Someone being pushed, pulled or carried against their own movement.',
    status: 'coming_soon',
    falsePositiveRate: null,
    resourceNote: null,
  },
]
