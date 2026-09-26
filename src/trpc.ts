import { QueryClient } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'

import type { AppRouter } from '../server/router'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/trpc`,
    }),
  ],
})

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
})
