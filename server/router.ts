import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

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
  climbs: t.router({
    list: t.procedure.query(() => climbs),
    create: t.procedure.input(climbInput).mutation(({ input }) => {
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
