import { PagePlaceholder } from '@/components/app-shell/page-placeholder'

export default function AdminSupportPage() {
  return (
    <PagePlaceholder
      eyebrow="Platform"
      title="Support"
      lead="Requests from tenants, with enough context to answer them without asking a customer to explain their own installation twice."
      coming={[
        'Open tickets, by tenant and by age.',
        "The tenant's setup beside the ticket — plan, sites, boxes, module flags, recent health.",
        'Provisioning and shipping requests for new Detecto Boxes.',
        'Escalations from a site that is degraded right now.',
      ]}
      note="Support sees configuration and system health. Reaching a tenant's footage takes their explicit, time-limited consent, and it is written into their audit log where they can see it."
    />
  )
}
