import { getSession, type Session } from '@auth/express'
import type { CreateExpressContextOptions } from '@trpc/server/adapters/express'

import { authConfig, authConfigured } from './auth.ts'

export type Context = {
  authConfigured: boolean
  session: Session | null
}

export async function createContext({
  req,
}: CreateExpressContextOptions): Promise<Context> {
  return {
    authConfigured,
    session: authConfigured ? await getSession(req, authConfig) : null,
  }
}
