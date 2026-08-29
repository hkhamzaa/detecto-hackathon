import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Our type scale is declared in Tailwind's `@theme`, which tailwind-merge has
 * no visibility into. Its built-in `font-size` group only recognises `base`
 * plus t-shirt sizes and arbitrary lengths, so every custom size — `text-meta`,
 * `text-body`, `text-data`, `text-display-*` — fell through to the catch-all
 * `text-*` colour group. Sitting later in the class string than the real colour
 * utility, the size then *won* the merge and deleted it:
 *
 *   twMerge('text-primary-foreground text-meta')  ->  'text-meta'
 *
 * Buttons therefore rendered their label in the inherited colour, which on both
 * surfaces is the same value as the button's own background. Registering the
 * scale puts each size back in the group it belongs to.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-xl',
            'display-lg',
            'display-md',
            'display-sm',
            'title',
            'body',
            'meta',
            'data',
            'micro',
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
