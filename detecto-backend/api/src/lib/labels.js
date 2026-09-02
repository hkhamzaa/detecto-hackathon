/** Mirrors detecto-frontend/src/lib/alerts/labels.ts's detectionLabel/KIND_LABEL — same wording, for audit summaries. */

const KIND_LABEL = {
  weapon: 'Weapon',
  violence: 'Violence',
};

/** `Weapon · handgun`, or just `Weapon` when the model only had the class. */
export function detectionLabel({ kind, subtype }) {
  const label = KIND_LABEL[kind] ?? kind;
  return subtype ? `${label} · ${subtype}` : label;
}
