import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

import type { Context } from './context'

const t = initTRPC.context<Context>().create()

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user?.email) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  })
})

const climbInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  grade: z.string().trim().min(1, 'Grade is required').max(12),
})

type Climb = z.infer<typeof climbInput> & {
  id: string
  createdAt: string
}

const climbs: Climb[] = [
  {
    id: crypto.randomUUID(),
    name: 'Warm-up circuit',
    grade: 'V2',
    createdAt: new Date().toISOString(),
  },
]

export const appRouter = t.router({
  health: t.procedure.query(() => ({ status: 'ok' as const })),
  auth: t.router({
    session: t.procedure.query(({ ctx }) => ({
      configured: ctx.authConfigured,
      user: ctx.session?.user ?? null,
    })),
  }),
  climbs: t.router({
    list: protectedProcedure.query(() => climbs),
    create: protectedProcedure.input(climbInput).mutation(({ input }) => {
      const climb: Climb = {
        id: crypto.randomUUID(),
        ...input,
        createdAt: new Date().toISOString(),
      }

      climbs.unshift(climb)
      return climb
    }),
  }),
})

export type AppRouter = typeof appRouter
