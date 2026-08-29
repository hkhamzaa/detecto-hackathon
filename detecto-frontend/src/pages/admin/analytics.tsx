import { PagePlaceholder } from '@/components/app-shell/page-placeholder'

export default function AdminAnalyticsPage() {
  return (
    <PagePlaceholder
      eyebrow="Platform"
      title="Analytics"
      lead="Detection volume, confirmation rates and false positives across the whole platform — the numbers that say whether the models are earning their place on someone's cameras."
      coming={[
        'Detections raised against detections a person confirmed, by module and by month.',
        'False-positive rate per model version, so a regression is visible in the release that caused it.',
        'Time from detection to human decision, and the sites where it is drifting.',
        'Volume by tenant, site type and hour of day.',
      ]}
      note="Aggregate only. Nothing on this page identifies a person a camera saw, and nothing on it is built to."
    />
  )
}
