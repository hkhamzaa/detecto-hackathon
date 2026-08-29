import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'

/**
 * The settings index.
 *
 * Four sections, each its own page rather than four panels stacked on one:
 * they are read at different times by different people, and a security setting
 * is not something to scroll past on the way to a phone number.
 */
const SECTIONS = [
  {
    to: '/org/settings/profile',
    label: 'Profile',
    lead: 'What your organisation is called, what kind of site it is, and who Detecto reaches about the account.',
    note: 'Invoices go to the billing contact on your billing page, which is set separately.',
  },
  {
    to: '/org/settings/notifications',
    label: 'Alert notifications',
    lead: 'Who is told when a detection is raised — by zone, by detection type, and what happens if an alert sits unreviewed.',
    note: 'Everyone routed there already holds a role here. Detecto keeps no separate contact list, and escalation only ever notifies a colleague.',
  },
  {
    to: '/org/settings/zones',
    label: 'Zones',
    lead: 'The places your cameras are in. Rename one everywhere at once, or merge two that turned out to be the same place.',
    note: 'A zone is what an alert names, what a role is held to, and what notifications are routed by — so the same word has to mean the same place in all three.',
  },
  {
    to: '/org/settings/security',
    label: 'Security',
    lead: 'How long a session lasts, what the password rule is, and what Detecto does not yet enforce.',
    note: 'The password rule is one line, and the page is plain about how much of the rest is not built.',
  },
]

export default function OrgSettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Settings"
        lead="How your organisation is set up: who you are, where your cameras are, where alerts go, and how sessions behave."
      />

      <div className="grid gap-6">
        {SECTIONS.map((section) => (
          <Panel key={section.to} label={section.label}>
            <PanelBody>
              <p className="max-w-2xl text-body text-neutral-700">{section.lead}</p>
              <p className="mt-3 max-w-2xl text-meta text-neutral-600">
                {section.note}
              </p>
              <Button asChild variant="outline" className="mt-5">
                <Link to={section.to}>
                  {section.label}
                  <ArrowRight />
                </Link>
              </Button>
            </PanelBody>
          </Panel>
        ))}

        <Panel label="Not here yet">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              Two things the nav item has always implied, and neither is built:
            </p>

            <ul className="mt-4 max-w-2xl space-y-2.5">
              {[
                'Sites, as a level above zones. An organisation with three buildings has three sets of zones that happen to share names, and nothing here models that yet — a zone is currently a flat name across the whole organisation.',
                "Retention, within your plan's limits. How long clips and detections are kept is set by the plan today and is not adjustable, so there is nothing here to change.",
              ].map((line) => (
                <li key={line} className="flex gap-3 text-meta text-neutral-600">
                  <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            <p className="mt-5 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
              Your own name, email and password are not here either — those are
              yours rather than your organisation's, and they are on your account
              page, reached from your email address in the header.
            </p>
          </PanelBody>
        </Panel>
      </div>
    </>
  )
}
