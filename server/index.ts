import 'dotenv/config'

import { ExpressAuth } from '@auth/express'
import { createExpressMiddleware } from '@trpc/server/adapters/express'
import express from 'express'

import { authConfig, authConfigured } from './auth.ts'
import { createContext } from './context.ts'
import { appRouter } from './router.ts'

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001)
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const app = express()

app.set('trust proxy', true)

app.use((request, response, next) => {
  const origin = request.headers.origin

  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('access-control-allow-origin', origin)
    response.setHeader('access-control-allow-credentials', 'true')
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
    response.setHeader(
      'access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'content-type',
    )
    response.setHeader('vary', 'Origin')
  }

  if (request.method === 'OPTIONS') {
    response.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403)
    return
  }

  next()
})

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' })
})

if (authConfigured) {
  app.use('/auth', ExpressAuth(authConfig))
} else {
  app.use('/auth', (_request, response) => {
    response.status(503).json({
      error: 'Google auth is not configured. See .env.example.',
    })
  })
}

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    maxBodySize: 10 * 1024 * 1024,
  }),
)

app.use((error: unknown, _request: express.Request, response: express.Response) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

app.listen(port, '0.0.0.0', () => {
  console.log(`API listening on http://localhost:${port}`)
  if (!authConfigured) {
    console.warn('Google auth is disabled until all AUTH_* environment values exist')
  }
})
