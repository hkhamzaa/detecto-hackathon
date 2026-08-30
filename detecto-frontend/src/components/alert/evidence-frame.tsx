/**
 * The still the model flagged, as it appears on the confirmation card.
 *
 * The corner marks are the style guide's evidence-frame motif, kept because
 * they say "this is a captured frame, not a live view" without a caption doing
 * it. When no still was captured the frame admits it is waiting for one rather
 * than filling itself with grey.
 *
 * `image` is a `data:` URL or nothing — see `parseAlert`, which is what makes
 * sure it can only ever be the former.
 */
export function EvidenceFrame({
  caption,
  image,
}: {
  caption: string
  image?: string
}) {
  return (
    <div>
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
        {image ? (
          // `contain`, not `cover`: this is evidence, and cropping it to fit a
          // 16:9 box would cut away part of what the model was looking at.
          // Portrait footage letterboxes rather than losing its edges.
          <img
            src={image}
            alt={`Captured frame — ${caption}`}
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <span className="label-micro text-neutral-600">Captured frame</span>
          </div>
        )}
      </div>
      <p className="mt-2 truncate font-mono text-micro uppercase tracking-[0.14em] text-neutral-500">
        {caption}
      </p>
    </div>
  )
}
