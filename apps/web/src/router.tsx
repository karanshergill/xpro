import "./functions/workspace-page.functions";
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  let isInitialRender = true
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: () => {
      // Preserve document scrolling during hydration; restore later client navigations.
      const shouldRestore = !isInitialRender
      isInitialRender = false
      return shouldRestore
    },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
