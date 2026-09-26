import http from 'node:http'

import { createHTTPHandler } from '@trpc/server/adapters/standalone'

import { appRouter } from './router.ts'

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

const trpcHandler = createHTTPHandler({
  router: appRouter,
  basePath: '/trpc/',
})

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }

  const origin = request.headers.origin
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    response.setHeader(
      'access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'content-type',
    )
    response.setHeader('vary', 'Origin')
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(origin && allowedOrigins.has(origin) ? 204 : 403)
    response.end()
    return
  }

  trpcHandler(request, response)
})

server.listen(port, '0.0.0.0', () => {
  console.log(`tRPC API listening on http://localhost:${port}/trpc`)
})
