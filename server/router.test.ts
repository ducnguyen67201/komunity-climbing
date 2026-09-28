import assert from 'node:assert/strict'
import test from 'node:test'

import type { Context } from './context'
import { appRouter } from './router'

const context: Context = {
  authConfigured: true,
  canReview: false,
  session: {
    user: { email: 'crud-test@example.com' },
    expires: '2099-01-01T00:00:00.000Z',
  },
}

const holds = [
  {
    id: 'hold-1',
    center: { x: 20, y: 30 },
    points: [{ x: 18, y: 28 }, { x: 22, y: 28 }, { x: 20, y: 32 }],
    source: 'detected' as const,
  },
  {
    id: 'hold-2',
    center: { x: 70, y: 80 },
    points: [{ x: 68, y: 78 }, { x: 72, y: 78 }, { x: 70, y: 82 }],
    source: 'manual' as const,
  },
]

test('supports owned wall and climb CRUD with wall-delete cascading', async () => {
  const caller = appRouter.createCaller(context)
  const wall = await caller.walls.create({
    name: 'North Cave',
    imageDataUrl: 'data:image/png;base64,aA==',
    imageWidth: 800,
    imageHeight: 1000,
    sourceType: 'photo',
    holds,
  })

  const climb = await caller.climbs.create({
    wallId: wall.id,
    name: 'Paper Tiger',
    grade: 'V4',
    status: 'submitted',
    assignments: [
      { holdId: 'hold-1', role: 'start' },
      { holdId: 'hold-2', role: 'finish' },
    ],
  })

  const updatedClimb = await caller.climbs.update({
    id: climb.id,
    name: 'Paper Tiger Direct',
    grade: 'V5',
    status: 'submitted',
    assignments: climb.assignments,
  })
  assert.equal(updatedClimb.name, 'Paper Tiger Direct')
  assert.equal(updatedClimb.grade, 'V5')

  await assert.rejects(
    caller.walls.update({ id: wall.id, name: 'North Cave Main', holds: [holds[0]] }),
    /removes a hold used by 1 saved climb/,
  )
  const [climbAfterRejectedRemoval] = await caller.climbs.list()
  assert.deepEqual(climbAfterRejectedRemoval.assignments, climb.assignments)

  await assert.rejects(
    caller.walls.create({
      name: 'Duplicate IDs',
      imageDataUrl: 'data:image/png;base64,aA==',
      imageWidth: 800,
      imageHeight: 1000,
      sourceType: 'photo',
      holds: [holds[0], { ...holds[1], id: holds[0].id }],
    }),
    /Each hold must have a unique id/,
  )

  const deletion = await caller.walls.delete({ id: wall.id })
  assert.equal(deletion.deletedClimbs, 1)
  assert.deepEqual(await caller.walls.list(), [])
  assert.deepEqual(await caller.climbs.list(), [])
})

test('allows partial drafts but requires every field before publishing', async () => {
  const ownerEmail = 'draft-owner@example.com'
  const owner = appRouter.createCaller({
    authConfigured: true,
    canReview: false,
    session: {
      user: { name: 'Draft owner', email: ownerEmail },
      expires: '2099-01-01T00:00:00.000Z',
    },
  })
  const member = appRouter.createCaller({
    authConfigured: true,
    canReview: false,
    session: {
      user: { email: 'member@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    },
  })
  const reviewer = appRouter.createCaller({
    authConfigured: true,
    canReview: true,
    session: {
      user: { name: 'Coach', email: 'coach@example.com' },
      expires: '2099-01-01T00:00:00.000Z',
    },
  })
  const wall = await owner.walls.create({
    name: 'Draft wall',
    imageDataUrl: 'data:image/png;base64,aA==',
    imageWidth: 800,
    imageHeight: 1000,
    sourceType: 'photo',
    holds,
  })
  const draft = await owner.climbs.create({
    wallId: wall.id,
    name: '',
    grade: '',
    assignments: [],
    status: 'draft',
  })

  assert.equal(draft.status, 'draft')
  assert.equal((await owner.climbs.list()).length, 1)
  assert.equal((await member.climbs.list()).length, 0)
  assert.equal((await reviewer.climbs.list()).length, 0)

  await assert.rejects(
    owner.climbs.update({
      id: draft.id,
      name: 'Incomplete route',
      grade: 'V4',
      assignments: [],
      status: 'submitted',
    }),
    /Choose at least two holds before publishing/,
  )

  const published = await owner.climbs.update({
    id: draft.id,
    name: 'Complete route',
    grade: 'V4',
    assignments: [
      { holdId: 'hold-1', role: 'start' },
      { holdId: 'hold-2', role: 'finish' },
    ],
    status: 'submitted',
  })

  assert.equal(published.status, 'submitted')
  assert.equal((await reviewer.climbs.list()).length, 1)

  await assert.rejects(
    reviewer.climbs.review({
      id: draft.id,
      decision: 'approve',
      rating: 6,
      comment: '',
    }),
  )

  const approved = await reviewer.climbs.review({
    id: draft.id,
    decision: 'approve',
    rating: 5,
    comment: 'Excellent route.',
  })

  assert.equal(approved.status, 'approved')
  assert.equal(approved.review?.rating, 5)
  assert.equal((await owner.climbs.list())[0]?.status, 'approved')
})

test('logs attempts and completion on saved climbs without changing the route', async () => {
  const owner = appRouter.createCaller({ ...context, session: { ...context.session!, user: { email: 'log-owner@example.com' } } })
  const stranger = appRouter.createCaller({ ...context, session: { ...context.session!, user: { email: 'log-stranger@example.com' } } })
  const reviewer = appRouter.createCaller({ ...context, canReview: true, session: { ...context.session!, user: { email: 'log-coach@example.com' } } })
  const anonymous = appRouter.createCaller({ ...context, session: null })
  const wall = await owner.walls.create({ name: 'Log wall', imageDataUrl: 'data:image/png;base64,aA==', imageWidth: 800, imageHeight: 1000, sourceType: 'photo', holds })
  const climb = await owner.climbs.create({ wallId: wall.id, name: 'Five tries', grade: 'V3', status: 'submitted', assignments: [{ holdId: 'hold-1', role: 'start' }, { holdId: 'hold-2', role: 'finish' }] })
  assert.deepEqual(climb.logs, [])
  const input = { id: climb.id, entryId: crypto.randomUUID(), attempts: 5, completed: false }
  for (const attempts of [0, -1, 1.5, 1000]) {
    await assert.rejects(owner.climbs.logAttempts({ ...input, attempts }))
  }
  await assert.rejects(stranger.climbs.logAttempts(input), /Climb not found/)
  await assert.rejects(reviewer.climbs.logAttempts(input), /Climb not found/)
  await assert.rejects(anonymous.climbs.logAttempts(input))
  await assert.rejects(owner.climbs.logAttempts({ ...input, id: crypto.randomUUID() }), /Climb not found/)
  const first = await owner.climbs.logAttempts(input)
  assert.equal(first.attempts, 5)
  assert.equal(first.completed, false)
  assert.deepEqual(await owner.climbs.logAttempts(input), first, 'retries do not duplicate logs')
  await assert.rejects(owner.climbs.logAttempts({ ...input, attempts: 6 }), /already been saved/)
  assert.deepEqual((await reviewer.climbs.list()).find((item) => item.id === climb.id)?.logs, [], 'logs remain private')
  await reviewer.climbs.review({ id: climb.id, decision: 'approve', rating: 5, comment: 'Good route' })
  await owner.climbs.logAttempts({ id: climb.id, entryId: crypto.randomUUID(), attempts: 2, completed: true })
  const saved = (await owner.climbs.list()).find((item) => item.id === climb.id)!
  assert.equal(saved.logs.length, 2)
  assert.equal(saved.logs.reduce((total, entry) => total + entry.attempts, 0), 7)
  assert.equal(saved.logs[0].completed, true)
  assert.equal(saved.status, 'approved')
  assert.equal(saved.review?.rating, 5)
  assert.deepEqual(saved.assignments, climb.assignments)
  await owner.walls.delete({ id: wall.id })
  await assert.rejects(owner.climbs.logAttempts(input), /Climb not found/)
})
