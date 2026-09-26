import 'dotenv/config'

import { type ExpressAuthConfig } from '@auth/express'
import Google from '@auth/express/providers/google'

const allowedRedirectOrigins = new Set(
  (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)

export const authConfigured = Boolean(
  process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET,
)

export const authConfig: ExpressAuthConfig = {
  providers: [Google],
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    redirect({ url, baseUrl }) {
      if (url.startsWith('/')) {
        return `${baseUrl}${url}`
      }

      try {
        const target = new URL(url)
        if (
          target.origin === baseUrl ||
          allowedRedirectOrigins.has(target.origin)
        ) {
          return url
        }
      } catch {
        // Fall through to the backend origin for malformed callback URLs.
      }

      return baseUrl
    },
  },
}
