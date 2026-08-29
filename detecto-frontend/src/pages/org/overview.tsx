import { PagePlaceholder } from '@/components/app-shell/page-placeholder'

export default function OrgOverviewPage() {
  return (
    <PagePlaceholder
      eyebrow="Organisation"
      title="Overview"
      lead="The state of your sites right now — what is being watched, what is waiting on a person, and what needs a decision today."
      coming={[
        'Cameras streaming, offline and degraded, grouped by site.',
        'Detections still unconfirmed, oldest first, and who is on watch.',
        'The last 24 hours: raised, confirmed, dismissed.',
        'Anything costing you coverage — a box offline, a stream dropped, a shift with nobody assigned.',
      ]}
      note="Detecto does not contact anyone on its own. Everything counted on this page is waiting on a person, by design."
    />
  )
}
