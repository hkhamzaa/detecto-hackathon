import { AlertQueue } from '@/components/alert/alert-queue'

/** A member's own watch. Same queue as the org view, scoped by the session. */
export default function AlertQueuePage() {
  return (
    <AlertQueue
      eyebrow="Watch"
      lead="Detections waiting on you. Each one is a flag from a model that nothing acts on until a person says so."
      basePath="/alerts"
    />
  )
}
