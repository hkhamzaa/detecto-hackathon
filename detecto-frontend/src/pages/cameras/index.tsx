import { PagePlaceholder } from '@/components/app-shell/page-placeholder'

export default function CamerasPage() {
  return (
    <PagePlaceholder
      eyebrow="Watch"
      title="Cameras"
      lead="The cameras you are assigned to, and whether each one is streaming right now."
      coming={[
        'Your cameras, by site and zone, with live stream state.',
        'Live view, and the last frame captured from each.',
        'Which detection modules are running on each camera.',
        'A clear marker on anything that stopped streaming, and when it stopped.',
      ]}
      note="You can watch these cameras. Changing what runs on them is an administrator's job, and it is deliberately not on this page."
    />
  )
}
