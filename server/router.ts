import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

import { detectHoldsWithAI, getAiDetectionStatus } from './aiHoldDetection'
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

const pointInput = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
})

const holdInput = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(['hand', 'foot', 'start', 'finish']),
  center: pointInput,
  points: z.array(pointInput).min(3).max(20),
})

const climbInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  grade: z.string().trim().min(1, 'Grade is required').max(12),
  wallName: z.string().trim().min(1).max(80),
  sourceType: z.enum(['photo', 'video', 'demo']),
  imageWidth: z.number().int().positive().max(10000),
  imageHeight: z.number().int().positive().max(10000),
  holds: z.array(holdInput).min(2, 'Choose at least two holds').max(120),
})

type Climb = z.infer<typeof climbInput> & {
  id: string
  createdAt: string
}

const climbs: Climb[] = []

const wallDetectionInput = z.object({
  imageDataUrl: z
    .string()
    .max(8_000_000)
    .refine(
      (value) => /^data:image\/(jpeg|png|webp);base64,/.test(value),
      'A JPEG, PNG, or WebP data URL is required',
    ),
})

export const appRouter = t.router({
  health: t.procedure.query(() => ({
    status: 'ok' as const,
    ai: getAiDetectionStatus(),
  })),
  auth: t.router({
    session: t.procedure.query(({ ctx }) => ({
      configured: ctx.authConfigured,
      user: ctx.session?.user ?? null,
    })),
  }),
  wall: t.router({
    detectHolds: protectedProcedure.input(wallDetectionInput).mutation(async ({ input }) => {
      if (!getAiDetectionStatus().enabled) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AI scanning is not configured',
        })
      }

      try {
        return {
          holds: await detectHoldsWithAI(input.imageDataUrl),
          model: getAiDetectionStatus().model,
        }
      } catch (error) {
        console.error('AI hold detection failed', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'AI scanning failed; the local detector can still be used',
        })
      }
    }),
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
