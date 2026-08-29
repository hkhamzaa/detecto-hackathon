import { AlertQueue } from '@/components/alert/alert-queue'

/** The same queue an operator sees, across every site in the organisation. */
export default function OrgAlertsPage() {
  return (
    <AlertQueue
      eyebrow="Organisation"
      lead="Detections waiting for a human decision, across every site in your organisation."
      basePath="/org/alerts"
    />
  )
}
