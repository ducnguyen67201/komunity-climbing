import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'

import { detectHoldsWithAI, getAiDetectionStatus } from './aiHoldDetection.ts'
import type { Context } from './context'

const t = initTRPC.context<Context>().create()

const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  const user = ctx.session?.user
  const ownerEmail = user?.email
  if (!ownerEmail) throw new TRPCError({ code: 'UNAUTHORIZED' })

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      ownerEmail,
      ownerName: user.name ?? ownerEmail,
    },
  })
})

const pointInput = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
})

const wallHoldInput = z.object({
  id: z.string().min(1).max(80),
  center: pointInput,
  points: z.array(pointInput).min(3).max(20),
  source: z.enum(['detected', 'ai', 'manual']),
})

const wallHoldsInput = z
  .array(wallHoldInput)
  .min(1, 'Keep at least one hold')
  .max(240)
  .superRefine((holds, ctx) => {
    const seen = new Set<string>()
    for (const [index, hold] of holds.entries()) {
      if (seen.has(hold.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each hold must have a unique id',
          path: [index, 'id'],
        })
      }
      seen.add(hold.id)
    }
  })

const wallCreateInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  imageDataUrl: z
    .string()
    .max(8_000_000)
    .refine(
      (value) => /^data:image\/(jpeg|png|webp);base64,/.test(value),
      'A JPEG, PNG, or WebP data URL is required',
    ),
  imageWidth: z.number().int().positive().max(10000),
  imageHeight: z.number().int().positive().max(10000),
  sourceType: z.enum(['photo', 'video', 'demo']),
  holds: wallHoldsInput,
})

const assignmentInput = z.object({
  holdId: z.string().min(1).max(80),
  role: z.enum(['hand', 'foot', 'start', 'finish']),
})

const editableClimbStatus = z.enum(['draft', 'submitted'])
const climbStatus = z.enum([
  'draft',
  'submitted',
  'changes_requested',
  'approved',
])
const climbDetailsShape = {
  name: z.string().trim().max(80),
  grade: z.string().trim().max(12),
  assignments: z.array(assignmentInput).max(240),
  status: editableClimbStatus,
}

const createClimbInput = z.object({
  wallId: z.string().uuid(),
  ...climbDetailsShape,
})

const updateClimbInput = z.object({
  id: z.string().uuid(),
  ...climbDetailsShape,
})

const reviewClimbInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(['approve', 'request_changes']),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500),
})

type Wall = z.infer<typeof wallCreateInput> & {
  id: string
  ownerEmail: string
  createdAt: string
  updatedAt: string
}

type Climb = {
  id: string
  wallId: string
  name: string
  grade: string
  assignments: Array<z.infer<typeof assignmentInput>>
  ownerEmail: string
  ownerName: string
  status: z.infer<typeof climbStatus>
  review: {
    decision: z.infer<typeof reviewClimbInput>['decision']
    rating: number
    comment: string
    reviewerEmail: string
    reviewerName: string
    reviewedAt: string
  } | null
  createdAt: string
  updatedAt: string
}

const walls: Wall[] = []
const climbs: Climb[] = []

function publicWall({ ownerEmail: _ownerEmail, ...wall }: Wall) {
  return wall
}

function publicClimb(climb: Climb, viewerEmail: string) {
  const wall = walls.find((item) => item.id === climb.wallId)

  return {
    id: climb.id,
    wallId: climb.wallId,
    wallName: wall?.name ?? 'Unknown wall',
    name: climb.name,
    grade: climb.grade,
    assignments: climb.assignments,
    ownerName: climb.ownerName,
    isOwner: climb.ownerEmail === viewerEmail,
    status: climb.status,
    review: climb.review
      ? {
          decision: climb.review.decision,
          rating: climb.review.rating,
          comment: climb.review.comment,
          reviewerName: climb.review.reviewerName,
          reviewedAt: climb.review.reviewedAt,
        }
      : null,
    createdAt: climb.createdAt,
    updatedAt: climb.updatedAt,
  }
}

function findWall(ownerEmail: string, id: string) {
  const wall = walls.find((item) => item.id === id && item.ownerEmail === ownerEmail)
  if (!wall) throw new TRPCError({ code: 'NOT_FOUND', message: 'Wall not found' })
  return wall
}

function findClimb(ownerEmail: string, id: string) {
  const climb = climbs.find((item) => item.id === id && item.ownerEmail === ownerEmail)
  if (!climb) throw new TRPCError({ code: 'NOT_FOUND', message: 'Climb not found' })
  return climb
}

function validateAssignments(
  wall: Wall,
  assignments: z.infer<typeof assignmentInput>[],
  requireComplete: boolean,
) {
  const holdIds = new Set(wall.holds.map((hold) => hold.id))
  const seen = new Set<string>()
  for (const assignment of assignments) {
    if (!holdIds.has(assignment.holdId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A selected hold no longer exists on this wall',
      })
    }
    if (seen.has(assignment.holdId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A hold can only have one role' })
    }
    seen.add(assignment.holdId)
  }
  if (!requireComplete) return
  if (assignments.length < 2) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose at least two holds before publishing',
    })
  }
  if (!assignments.some((assignment) => assignment.role === 'start')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose at least one start hold before publishing',
    })
  }
  if (!assignments.some((assignment) => assignment.role === 'finish')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Choose at least one finish hold before publishing',
    })
  }
}

function validateClimbForPublish(
  wall: Wall,
  climb: Pick<Climb, 'name' | 'grade' | 'assignments' | 'status'>,
) {
  const isPublishing = climb.status === 'submitted'

  if (isPublishing && !climb.name) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Climb name is required before publishing',
    })
  }
  if (isPublishing && !climb.grade) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Grade is required before publishing',
    })
  }

  validateAssignments(wall, climb.assignments, isPublishing)
}

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
      canReview: ctx.canReview,
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
  walls: t.router({
    list: protectedProcedure.query(({ ctx }) =>
      walls
        .filter((wall) => wall.ownerEmail === ctx.ownerEmail)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(publicWall),
    ),
    create: protectedProcedure.input(wallCreateInput).mutation(({ ctx, input }) => {
      const now = new Date().toISOString()
      const wall: Wall = {
        id: crypto.randomUUID(),
        ownerEmail: ctx.ownerEmail,
        ...input,
        createdAt: now,
        updatedAt: now,
      }
      walls.unshift(wall)
      return publicWall(wall)
    }),
    update: protectedProcedure
      .input(z.object({ id: z.string().uuid(), name: wallCreateInput.shape.name, holds: wallCreateInput.shape.holds }))
      .mutation(({ ctx, input }) => {
        const wall = findWall(ctx.ownerEmail, input.id)
        const validIds = new Set(input.holds.map((hold) => hold.id))
        const affectedClimbs = climbs.filter(
          (climb) => climb.wallId === wall.id
            && climb.ownerEmail === ctx.ownerEmail
            && climb.assignments.some((assignment) => !validIds.has(assignment.holdId)),
        )
        if (affectedClimbs.length > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `This edit removes a hold used by ${affectedClimbs.length} saved climb${affectedClimbs.length === 1 ? '' : 's'}. Update or delete those climbs first.`,
          })
        }
        wall.name = input.name
        wall.holds = input.holds
        wall.updatedAt = new Date().toISOString()
        return publicWall(wall)
      }),
    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => {
      const wallIndex = walls.findIndex(
        (wall) => wall.id === input.id && wall.ownerEmail === ctx.ownerEmail,
      )
      if (wallIndex < 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Wall not found' })
      walls.splice(wallIndex, 1)

      let deletedClimbs = 0
      for (let index = climbs.length - 1; index >= 0; index -= 1) {
        if (climbs[index].wallId === input.id && climbs[index].ownerEmail === ctx.ownerEmail) {
          climbs.splice(index, 1)
          deletedClimbs += 1
        }
      }
      return { id: input.id, deletedClimbs }
    }),
  }),
  climbs: t.router({
    list: protectedProcedure.query(({ ctx }) =>
      climbs
        .filter(
          (climb) =>
            climb.ownerEmail === ctx.ownerEmail ||
            (ctx.canReview && climb.status === 'submitted'),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((climb) => publicClimb(climb, ctx.ownerEmail)),
    ),
    create: protectedProcedure
      .input(createClimbInput)
      .mutation(({ ctx, input }) => {
        const wall = findWall(ctx.ownerEmail, input.wallId)
        validateClimbForPublish(wall, input)
        const now = new Date().toISOString()
        const climb: Climb = {
          id: crypto.randomUUID(),
          ownerEmail: ctx.ownerEmail,
          ownerName: ctx.ownerName,
          ...input,
          review: null,
          createdAt: now,
          updatedAt: now,
        }
        climbs.unshift(climb)
        return publicClimb(climb, ctx.ownerEmail)
      }),
    update: protectedProcedure
      .input(updateClimbInput)
      .mutation(({ ctx, input }) => {
        const climb = findClimb(ctx.ownerEmail, input.id)

        if (climb.status === 'approved') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Approved climbs cannot be changed',
          })
        }

        const wall = findWall(ctx.ownerEmail, climb.wallId)
        validateClimbForPublish(wall, input)
        climb.name = input.name
        climb.grade = input.grade
        climb.assignments = input.assignments
        climb.status = input.status
        climb.review = null
        climb.updatedAt = new Date().toISOString()
        return publicClimb(climb, ctx.ownerEmail)
      }),
    review: protectedProcedure
      .input(reviewClimbInput)
      .mutation(({ ctx, input }) => {
        if (!ctx.canReview) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Reviewer access is required',
          })
        }

        const climb = climbs.find((item) => item.id === input.id)
        if (!climb) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Climb not found' })
        }
        if (climb.ownerEmail === ctx.ownerEmail) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You cannot review your own climb',
          })
        }
        if (climb.status !== 'submitted') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Only published climbs can be reviewed',
          })
        }

        const reviewedAt = new Date().toISOString()
        climb.status =
          input.decision === 'approve' ? 'approved' : 'changes_requested'
        climb.review = {
          decision: input.decision,
          rating: input.rating,
          comment: input.comment,
          reviewerEmail: ctx.ownerEmail,
          reviewerName: ctx.ownerName,
          reviewedAt,
        }
        climb.updatedAt = reviewedAt

        return publicClimb(climb, ctx.ownerEmail)
      }),
    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ ctx, input }) => {
      const climbIndex = climbs.findIndex(
        (climb) => climb.id === input.id && climb.ownerEmail === ctx.ownerEmail,
      )
      if (climbIndex < 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Climb not found' })
      climbs.splice(climbIndex, 1)
      return { id: input.id }
    }),
  }),
})

export type AppRouter = typeof appRouter
