import { PagePlaceholder } from '@/components/app-shell/page-placeholder'

export default function OrgHistoryPage() {
  return (
    <PagePlaceholder
      eyebrow="Organisation"
      title="History"
      lead="Every detection Detecto has raised for you, confirmed or not, with the clip and the decision attached to it."
      coming={[
        'Search by date, site, camera, module, outcome and confidence.',
        "The clip, the captured frame and the model's reading, side by side.",
        'Who decided, what they decided, and how long it took them.',
        'Export a single incident as a file you can hand to someone outside Detecto.',
      ]}
      note="Retention follows your plan — 30 or 90 days. Anything exported before then lives on your side afterwards, not ours."
    />
  )
}
