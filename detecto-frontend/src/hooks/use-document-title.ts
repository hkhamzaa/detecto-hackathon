import { useEffect } from 'react'

/**
 * The browser tab follows the route. No cleanup: the next route sets its own,
 * and a stale title is less confusing than a flash of the default one.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Detecto`
  }, [title])
}
