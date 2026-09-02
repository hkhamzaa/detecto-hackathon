import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'

import { bootstrapSession, installSessionRefresh } from '@/lib/auth/session'
import { queryClient } from '@/lib/query-client'
import { router } from '@/routes/router'
import '@/index.css'

installSessionRefresh()

/**
 * Gates the router behind the boot-time silent refresh. Without this, a
 * hard reload would render `RequireSession` (routes/guard.tsx) before the
 * refresh call resolves — it has nothing in memory yet either way, so it
 * would bounce straight to /login instead of waiting to find out the
 * httpOnly cookie says otherwise.
 */
function App() {
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    bootstrapSession().finally(() => setBooted(true))
  }, [])

  // A blank frame in the app's own background, not a spinner: this resolves
  // in one network round trip, and is gone before a loading state would
  // read as anything but a flash.
  if (!booted) return <div className="min-h-dvh bg-ink" />

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root was not found')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
