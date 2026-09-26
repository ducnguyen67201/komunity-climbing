import { getSession, type Session } from '@auth/express'
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'

import { authConfig, authConfigured } from './auth.ts'

export type Context = {
  authConfigured: boolean
  canReview: boolean
  session: Session | null
}

const reviewerEmails = new Set(
  (process.env.REVIEWER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
)

export async function createContext({
  req,
}: CreateExpressContextOptions): Promise<Context> {
  const session = authConfigured ? await getSession(req, authConfig) : null

  return {
    authConfigured,
    canReview: reviewerEmails.has(session?.user?.email?.toLowerCase() ?? ''),
    session,
  }
}
