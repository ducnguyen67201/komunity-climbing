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

  const approved = await reviewer.climbs.review({
    id: draft.id,
    decision: 'approve',
    grade: 'V5',
    comment: 'Grade confirmed.',
  })

  assert.equal(approved.status, 'approved')
  assert.equal(approved.review?.grade, 'V5')
  assert.equal((await owner.climbs.list())[0]?.status, 'approved')
})
