import { useState, type ReactNode } from 'react'
import { Menu, RotateCcw, X } from 'lucide-react'

import { HoldToConfirm } from '@/components/alert/hold-to-confirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/ui-store'

const SECTIONS = [
  { id: 'color', label: 'Color' },
  { id: 'type', label: 'Type scale' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'data', label: 'Data table' },
  { id: 'confirm', label: 'Alert confirmation' },
] as const

export default function StyleGuidePage() {
  const navOpen = useUiStore((s) => s.navOpen)
  const toggleNav = useUiStore((s) => s.toggleNav)
  const closeNav = useUiStore((s) => s.closeNav)

  return (
    <div className="min-h-dvh bg-ink">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2 focus:text-meta focus:text-ink"
      >
        Skip to content
      </a>

      {/* --- Chrome: header ------------------------------------------------ */}
      <header className="dark sticky top-0 z-30 border-b border-ink-hairline bg-ink">
        <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-signal-500"
            />
            <span className="font-display text-title font-semibold tracking-tight text-paper">
              Detecto
            </span>
            <span className="label-micro hidden text-neutral-500 sm:inline">
              Internal style guide
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="label-micro hidden text-neutral-500 md:inline">
              foundation v0.1 · not for release
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-paper lg:hidden"
              aria-expanded={navOpen}
              aria-controls="section-nav"
              onClick={toggleNav}
            >
              {navOpen ? <X /> : <Menu />}
              <span className="sr-only">
                {navOpen ? 'Close section navigation' : 'Open section navigation'}
              </span>
            </Button>
          </div>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_1fr]">
        {/* --- Chrome: sidebar --------------------------------------------- */}
        <aside
          id="section-nav"
          className={cn(
            'dark border-b border-ink-hairline bg-ink px-4 py-4 sm:px-6',
            'lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-3.5rem)] lg:border-b-0 lg:border-r lg:py-8',
            navOpen ? 'block' : 'hidden',
          )}
        >
          <p className="label-micro mb-3 text-neutral-500">Sections</p>
          <nav>
            <ul className="space-y-0.5">
              {SECTIONS.map((section, i) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    onClick={closeNav}
                    className={cn(
                      'flex items-baseline gap-3 rounded-md px-2 py-1.5 text-meta text-neutral-300',
                      'transition-colors hover:bg-ink-raised hover:text-paper',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                  >
                    <span className="label-micro text-neutral-600">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    {section.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* --- Content: the lit surface ------------------------------------ */}
        <main id="content" className="min-w-0 bg-paper text-ink">
          <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
            <header className="mb-16 sm:mb-24">
              <p className="label-micro mb-4 text-neutral-500">
                Design foundation
              </p>
              <h1 className="font-display text-display-lg font-semibold text-ink sm:text-display-xl">
                A lit evidence table in a quiet control room.
              </h1>
              <p className="mt-6 max-w-2xl text-body text-neutral-600">
                Detecto layers weapon and violence detection onto cameras a
                customer already owns. Every AI flag waits for a human before it
                escalates — nothing reaches authorities on the model's word
                alone. The interface is built to stay quiet so that one moment of
                human judgement is the loudest thing in it.
              </p>
            </header>

            <ColorSection />
            <TypeSection />
            <ButtonSection />
            <DataSection />
            <ConfirmSection />

            <footer className="mt-24 border-t border-neutral-200 pt-8">
              <p className="label-micro text-neutral-500">
                Foundation pass · no feature pages built yet
              </p>
              <p className="mt-3 max-w-2xl text-meta text-neutral-600">
                Everything above is responsive from 320px up, exposes a visible
                focus ring on keyboard navigation, and respects{' '}
                <code className="font-mono text-data">prefers-reduced-motion</code>.
              </p>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Section shell                                                              */
/* -------------------------------------------------------------------------- */

function Section({
  id,
  index,
  title,
  intro,
  children,
}: {
  id: string
  index: string
  title: string
  intro: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-neutral-200 py-14 sm:py-20">
      <div className="mb-10">
        <p className="label-micro mb-4 text-neutral-500">
          {index} — {title}
        </p>
        <p className="max-w-2xl text-body text-neutral-600">{intro}</p>
      </div>
      {children}
    </section>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 font-display text-display-sm font-medium text-ink">
      {children}
    </h2>
  )
}

/* -------------------------------------------------------------------------- */
/* 01 — Color                                                                 */
/* -------------------------------------------------------------------------- */

const CORE_COLORS = [
  {
    name: 'Ink',
    hex: '#14181F',
    token: 'bg-ink',
    swatch: 'bg-ink',
    fg: 'text-paper',
    rule: 'Chrome. Sidebar, header, alert shells. Never a content background.',
  },
  {
    name: 'Paper',
    hex: '#F7F6F3',
    token: 'bg-paper',
    swatch: 'bg-paper border border-neutral-200',
    fg: 'text-ink',
    rule: 'The evidence surface. Tables, records, anything read closely.',
  },
  {
    name: 'Signal',
    hex: '#D64545',
    token: 'bg-signal-500',
    swatch: 'bg-signal-500',
    fg: 'text-white',
    rule: 'On alert surfaces it means one thing: unconfirmed. Elsewhere, the ordinary error and danger color. Never decoration.',
  },
  {
    name: 'Confirm',
    hex: '#3E7C6B',
    token: 'bg-confirm-500',
    swatch: 'bg-confirm-500',
    fg: 'text-white',
    rule: 'Human-verified state and trust actions. Also carries the focus ring.',
  },
]

const NEUTRAL_RAMP = [
  { step: '50', hex: '#F0EFED', className: 'bg-neutral-50' },
  { step: '100', hex: '#E5E4E2', className: 'bg-neutral-100' },
  { step: '200', hex: '#D0D0CF', className: 'bg-neutral-200' },
  { step: '300', hex: '#B7B8B8', className: 'bg-neutral-300' },
  { step: '400', hex: '#9C9D9E', className: 'bg-neutral-400' },
  { step: '500', hex: '#7F8083', className: 'bg-neutral-500' },
  { step: '600', hex: '#616467', className: 'bg-neutral-600' },
  { step: '700', hex: '#46494E', className: 'bg-neutral-700' },
  { step: '800', hex: '#31353B', className: 'bg-neutral-800' },
  { step: '900', hex: '#22262C', className: 'bg-neutral-900' },
  { step: '950', hex: '#14181F', className: 'bg-neutral-950' },
]

function ColorSection() {
  return (
    <Section
      id="color"
      index="01"
      title="Color"
      intro="Four anchors and one ramp. Signal is rationed on the surfaces where it carries meaning: on the alert queue, on confirmation cards, and on status badges tied to a camera detection it says one thing — a flag no human has confirmed yet. Away from those surfaces it does ordinary work as the system's error and danger color, including form validation on login, signup and settings."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {CORE_COLORS.map((color) => (
          <div
            key={color.name}
            className="overflow-hidden rounded-md border border-neutral-200 bg-paper-raised"
          >
            <div
              className={cn(
                'flex h-28 items-end justify-between p-4',
                color.swatch,
                color.fg,
              )}
            >
              <span className="font-display text-display-sm font-medium">
                {color.name}
              </span>
              <span className="font-mono text-data">{color.hex}</span>
            </div>
            <div className="p-4">
              <code className="font-mono text-data text-neutral-500">
                {color.token}
              </code>
              <p className="mt-2 text-meta text-neutral-600">{color.rule}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10">
        <SubHeading>Neutral ramp</SubHeading>
        <p className="mb-4 max-w-2xl text-meta text-neutral-600">
          Interpolated step by step between Ink and Paper, so chrome and content
          never look like they came from different systems.
        </p>
        <div className="overflow-hidden rounded-md border border-neutral-200">
          <div className="flex">
            {NEUTRAL_RAMP.map((swatch) => (
              <div
                key={swatch.step}
                className={cn('h-16 flex-1', swatch.className)}
                title={`neutral-${swatch.step} ${swatch.hex}`}
              />
            ))}
          </div>
          <div className="flex bg-paper-raised">
            {NEUTRAL_RAMP.map((swatch) => (
              <div
                key={swatch.step}
                className="flex-1 border-l border-neutral-200 px-1 py-2 text-center first:border-l-0"
              >
                <span className="font-mono text-micro text-neutral-500">
                  {swatch.step}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 02 — Type                                                                  */
/* -------------------------------------------------------------------------- */

const TYPE_SPECIMENS = [
  {
    className: 'font-display text-display-xl font-semibold',
    sample: 'Twelve cameras',
    spec: 'display-xl · 56/57 · -0.035em · General Sans 600',
    note: 'Page-level statement. One per screen at most.',
  },
  {
    className: 'font-display text-display-lg font-semibold',
    sample: 'Alert queue',
    spec: 'display-lg · 40/42 · -0.03em · General Sans 600',
    note: 'Route titles.',
  },
  {
    className: 'font-display text-display-md font-medium',
    sample: 'Unconfirmed detections',
    spec: 'display-md · 28/32 · -0.022em · General Sans 500',
    note: 'Panel and card headings.',
  },
  {
    className: 'font-display text-display-sm font-medium',
    sample: 'West corridor, level 2',
    spec: 'display-sm · 20/25 · -0.015em · General Sans 500',
    note: 'Sub-headings and dense card titles.',
  },
  {
    className: 'font-sans text-title',
    sample: 'A person has to look at this before anyone is called.',
    spec: 'title · 17/25 · Inter 400',
    note: 'Lead paragraphs and primary controls.',
  },
  {
    className: 'font-sans text-body',
    sample:
      'Detection ran on the existing camera feed; no hardware was replaced. Confirmation is required before escalation.',
    spec: 'body · 15/24 · Inter 400',
    note: 'Default reading size across the dashboard.',
  },
  {
    className: 'font-sans text-meta text-neutral-600',
    sample: 'Last synced 4 minutes ago · 3 cameras degraded',
    spec: 'meta · 13/20 · Inter 400',
    note: 'Secondary and supporting copy.',
  },
  {
    className: 'font-mono text-data',
    sample: 'CAM-04 · 0.94 · 2026-08-25T14:32:07Z',
    spec: 'data · 13/19 · +0.01em · JetBrains Mono 400',
    note: 'Real surveillance metadata: IDs, confidence, timestamps.',
  },
  {
    className: 'label-micro text-neutral-500',
    sample: 'Awaiting human confirmation',
    spec: 'micro · 11/15 · +0.14em · JetBrains Mono, uppercase',
    note: 'Column labels, badges, section eyebrows.',
  },
]

function TypeSection() {
  return (
    <Section
      id="type"
      index="02"
      title="Type scale"
      intro="Three families with strict jobs. General Sans states, Inter explains, JetBrains Mono carries anything the system measured — the mono is here because the product is genuinely full of machine metadata, not as decoration."
    >
      <div className="divide-y divide-neutral-200 border-y border-neutral-200">
        {TYPE_SPECIMENS.map((specimen) => (
          <div
            key={specimen.spec}
            className="grid gap-3 py-6 sm:grid-cols-[1fr_15rem] sm:gap-8"
          >
            <p className={cn('min-w-0 break-words text-ink', specimen.className)}>
              {specimen.sample}
            </p>
            <div className="sm:pt-1.5">
              <p className="font-mono text-micro uppercase tracking-[0.08em] text-neutral-500">
                {specimen.spec}
              </p>
              <p className="mt-1.5 text-meta text-neutral-600">{specimen.note}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 03 — Buttons                                                               */
/* -------------------------------------------------------------------------- */

const VARIANTS = [
  { variant: 'default', label: 'Primary', note: 'Default commit action.' },
  { variant: 'secondary', label: 'Secondary', note: 'Equal-weight alternative.' },
  { variant: 'outline', label: 'Outline', note: 'Low-emphasis, on Paper.' },
  { variant: 'ghost', label: 'Ghost', note: 'Toolbars and chrome.' },
  {
    variant: 'confirm',
    label: 'Verify',
    note: 'Trust actions that record a human decision.',
  },
  {
    variant: 'destructive',
    label: 'Escalate',
    note: 'Signal. Only after a confirmation has been given.',
  },
] as const

function ButtonSection() {
  return (
    <Section
      id="buttons"
      index="03"
      title="Buttons"
      intro="Small radii, no gradients, no shadows. Hover, active and focus are live below — tab through them to see the focus ring, which sits on Confirm so that Signal is never spent on a state as ordinary as focus."
    >
      <div className="rounded-md border border-neutral-200 bg-paper-raised p-5 sm:p-6">
        <p className="label-micro mb-5 text-neutral-500">On paper</p>
        <div className="grid gap-5 sm:grid-cols-2">
          {VARIANTS.map((item) => (
            <div key={item.variant} className="flex items-start gap-4">
              <Button variant={item.variant}>{item.label}</Button>
              <p className="pt-1.5 text-meta text-neutral-600">{item.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="dark mt-4 rounded-md border border-ink-hairline bg-ink p-5 sm:p-6">
        <p className="label-micro mb-5 text-neutral-500">On chrome</p>
        <div className="flex flex-wrap gap-3">
          {VARIANTS.map((item) => (
            <Button key={item.variant} variant={item.variant}>
              {item.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-10">
        <SubHeading>States and sizes</SubHeading>
        <div className="rounded-md border border-neutral-200 bg-paper-raised p-5 sm:p-6">
          <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
            <StateItem label="Rest">
              <Button>Confirm</Button>
            </StateItem>
            <StateItem label="Focus-visible (forced)">
              <Button className="outline-2 outline-offset-2 outline-ring">
                Confirm
              </Button>
            </StateItem>
            <StateItem label="Disabled">
              <Button disabled>Confirm</Button>
            </StateItem>
            <StateItem label="Hover / active">
              <Button>Point at me</Button>
            </StateItem>
            <StateItem label="Sizes">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Reset">
                  <RotateCcw />
                </Button>
              </div>
            </StateItem>
          </dl>
        </div>
      </div>
    </Section>
  )
}

function StateItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label-micro mb-3 text-neutral-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 04 — Data table                                                            */
/* -------------------------------------------------------------------------- */

const ALERT_ROWS = [
  {
    id: 'ALR-2291',
    camera: 'CAM-04',
    zone: 'West corridor',
    detection: 'Weapon · handgun',
    confidence: '0.94',
    time: '14:32:07',
    status: 'unconfirmed' as const,
  },
  {
    id: 'ALR-2290',
    camera: 'CAM-11',
    zone: 'Loading bay',
    detection: 'Violence · altercation',
    confidence: '0.81',
    time: '14:19:44',
    status: 'confirmed' as const,
  },
  {
    id: 'ALR-2288',
    camera: 'CAM-02',
    zone: 'Main entrance',
    detection: 'Weapon · knife',
    confidence: '0.63',
    time: '13:58:12',
    status: 'dismissed' as const,
  },
]

const STATUS_LABEL = {
  unconfirmed: 'Awaiting human',
  confirmed: 'Confirmed',
  dismissed: 'False positive',
}

function DataSection() {
  return (
    <Section
      id="data"
      index="04"
      title="Data table"
      intro="Dense but not cramped. Machine-produced values are set in mono with tabular figures so columns of confidence scores and timestamps align down the page; human-readable labels stay in Inter."
    >
      <div className="rounded-md border border-neutral-200 bg-paper-raised px-5 py-4 sm:px-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alert</TableHead>
              <TableHead>Camera</TableHead>
              <TableHead>Detection</TableHead>
              <TableHead className="text-right">Conf.</TableHead>
              <TableHead className="text-right">Time</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALERT_ROWS.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-data text-neutral-600">
                  {row.id}
                </TableCell>
                <TableCell>
                  <span className="font-mono text-data">{row.camera}</span>
                  <span className="ml-2 whitespace-nowrap text-meta text-neutral-500">
                    {row.zone}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.detection}
                </TableCell>
                <TableCell className="text-right font-mono text-data">
                  {row.confidence}
                </TableCell>
                <TableCell className="text-right font-mono text-data text-neutral-600">
                  {row.time}
                </TableCell>
                <TableCell>
                  <Badge variant={row.status}>{STATUS_LABEL[row.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-meta text-neutral-500">
        Below <code className="font-mono text-data">640px</code> the table scrolls
        horizontally inside its own container rather than reflowing — operators
        compare rows against each other, so the column relationship has to
        survive a small screen.
      </p>
    </Section>
  )
}

/* -------------------------------------------------------------------------- */
/* 05 — Alert confirmation                                                    */
/* -------------------------------------------------------------------------- */

function ConfirmSection() {
  const [resetKey, setResetKey] = useState(0)

  return (
    <Section
      id="confirm"
      index="05"
      title="Alert confirmation"
      intro="This is the only interaction in Detecto allowed to feel heavy. Everything else is deliberately quiet so that this one reads as a decision rather than a click — it is the moment a person takes responsibility for a model's flag, and nothing escalates until they do."
    >
      {/* The live mockup, on chrome, as it would appear in the alert drawer. */}
      <div className="dark overflow-hidden rounded-md border border-ink-hairline bg-ink">
        <div className="flex items-center justify-between gap-4 border-b border-ink-hairline px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-signal-500"
            />
            <span className="label-micro text-signal-300">
              Unconfirmed detection
            </span>
          </div>
          <span className="font-mono text-data text-neutral-500">ALR-2291</span>
        </div>

        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:p-6">
          <div className="order-2 sm:order-1">
            <h3 className="font-display text-display-md font-medium text-paper">
              Weapon detected
            </h3>
            <p className="mt-2 max-w-md text-meta text-neutral-400">
              A handgun-class object was matched on the west corridor feed. No
              notification has left this system.
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-sm">
              <Field label="Camera" value="CAM-04" />
              <Field label="Confidence" value="0.94" />
              <Field label="Detected" value="14:32:07" />
              <Field label="Model" value="wv-detect 3.2" />
            </dl>

            <div className="mt-7 max-w-md">
              <HoldToConfirm key={resetKey} />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" className="text-neutral-300">
                  Dismiss as false positive
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-neutral-500"
                  onClick={() => setResetKey((k) => k + 1)}
                >
                  <RotateCcw />
                  Reset demo
                </Button>
              </div>
            </div>
          </div>

          {/* Evidence frame placeholder — no imagery in the foundation pass. */}
          <div className="order-1 sm:order-2">
            <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-neutral-800 bg-neutral-900">
              <span
                aria-hidden="true"
                className="absolute left-2.5 top-2.5 size-4 border-l border-t border-signal-500/70"
              />
              <span
                aria-hidden="true"
                className="absolute right-2.5 top-2.5 size-4 border-r border-t border-signal-500/70"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-2.5 left-2.5 size-4 border-b border-l border-signal-500/70"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-2.5 right-2.5 size-4 border-b border-r border-signal-500/70"
              />
              <div className="absolute inset-0 grid place-items-center">
                <span className="label-micro text-neutral-600">
                  Captured frame
                </span>
              </div>
            </div>
            <p className="mt-2 font-mono text-micro uppercase tracking-[0.14em] text-neutral-500">
              cam-04 · 00:00:04.120
            </p>
          </div>
        </div>
      </div>

      {/* The reduced-motion variant, shown side by side for review. */}
      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <div className="rounded-md border border-neutral-200 bg-paper-raised p-5 sm:p-6">
          <p className="label-micro mb-4 text-neutral-500">
            Default — press and hold
          </p>
          <HoldToConfirm key={`hold-${resetKey}`} />
        </div>
        <div className="rounded-md border border-neutral-200 bg-paper-raised p-5 sm:p-6">
          <p className="label-micro mb-4 text-neutral-500">
            Reduced motion — two-stage
          </p>
          <HoldToConfirm key={`two-${resetKey}`} forceTwoStage />
        </div>
      </div>

      <div className="mt-10">
        <SubHeading>Interaction rules</SubHeading>
        <ul className="max-w-2xl space-y-3 text-body text-neutral-600">
          <Rule>
            The operator holds for <Mono>1.4s</Mono>. The fill is driven by real
            elapsed time, not an animation curve, so what they see is the
            commitment actually accruing.
          </Rule>
          <Rule>
            Releasing early aborts and says so — <Mono>released — not confirmed</Mono>{' '}
            — rather than silently resetting.
          </Rule>
          <Rule>
            Keyboard operators hold <Mono>Space</Mono> or <Mono>Enter</Mono>; key
            repeat is ignored so the hold cannot be faked by a stuck key.
          </Rule>
          <Rule>
            Under <Mono>prefers-reduced-motion</Mono> the duration cue would carry
            no information, so the control becomes an explicit two-stage confirm
            that disarms itself after 8 seconds. It does not just animate faster.
          </Rule>
          <Rule>
            State changes are announced through a polite live region; the outcome
            is never conveyed by colour alone.
          </Rule>
          <Rule>
            Confirmation unlocks escalation. It does not perform it — no alert
            leaves Detecto without a second, separate human action.
          </Rule>
        </ul>
      </div>
    </Section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-micro text-neutral-500">{label}</dt>
      <dd className="mt-1 font-mono text-data text-paper">{value}</dd>
    </div>
  )
}

function Rule({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-2.5 size-1 shrink-0 bg-neutral-400" />
      <span>{children}</span>
    </li>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-data text-ink">{children}</code>
}
