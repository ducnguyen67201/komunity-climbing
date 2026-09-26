import { createHTTPServer } from '@trpc/server/adapters/standalone'

import { appRouter } from './router'

const port = Number(process.env.API_PORT ?? 3001)

createHTTPServer({
  router: appRouter,
  basePath: '/trpc/',
}).listen(port, () => {
  console.log(`tRPC API listening on http://localhost:${port}/trpc`)
})
