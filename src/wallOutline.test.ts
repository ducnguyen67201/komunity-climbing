import assert from 'node:assert/strict'
import test from 'node:test'

import type { DetectedHold, Point } from './wallDetection'
import {
  applyHoldOutline,
  eraseHoldsAlongPath,
  polygonArea,
  simplifyHoldOutline,
} from './wallOutline'

function rectangle(left: number, top: number, right: number, bottom: number): Point[] {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ]
}

function hold(id: string, left: number, top: number, right: number, bottom: number): DetectedHold {
  return {
    id,
    points: rectangle(left, top, right, bottom),
    center: { x: (left + right) / 2, y: (top + bottom) / 2 },
    role: null,
    source: 'detected',
  }
}

test('simplifies a dense trace to a valid API-sized polygon', () => {
  const trace = Array.from({ length: 80 }, (_, index) => {
    const angle = (index / 79) * Math.PI * 2
    return { x: 50 + Math.cos(angle) * 12, y: 50 + Math.sin(angle) * 8 }
  })
  const simplified = simplifyHoldOutline(trace, 1.3)
  assert.ok(simplified)
  assert.ok(simplified.length >= 3 && simplified.length <= 18)
  assert.ok(polygonArea(simplified) > 100)
})

test('rejects tiny scribbles', () => {
  assert.equal(simplifyHoldOutline(rectangle(10, 10, 10.2, 10.2), 1), null)
})

test('replaces a partial detection and preserves its id', () => {
  const result = applyHoldOutline(
    [hold('partial', 42, 44, 50, 56), hold('neighbor', 61, 44, 68, 56)],
    rectangle(38, 40, 55, 60),
    1,
  )
  assert.ok(result)
  assert.equal(result.action, 'replaced')
  assert.equal(result.holds.length, 2)
  assert.equal(result.holds[0].id, 'partial')
  assert.equal(result.holds[0].source, 'manual')
  assert.equal(result.holds[1].id, 'neighbor')
})

test('merges enclosed fragments into one corrected hold', () => {
  const result = applyHoldOutline(
    [hold('fragment-a', 40, 45, 45, 54), hold('fragment-b', 46, 45, 51, 54)],
    rectangle(37, 40, 54, 59),
    1,
  )
  assert.ok(result)
  assert.equal(result.action, 'merged')
  assert.equal(result.matchedCount, 2)
  assert.equal(result.holds.length, 1)
  assert.equal(result.holds[0].id, 'fragment-a')
})

test('does not merge a separate nearby hold swallowed by an oversized trace', () => {
  const result = applyHoldOutline(
    [hold('partial', 40, 44, 45, 54), hold('neighbor', 58, 44, 65, 54)],
    rectangle(37, 40, 68, 59),
    1,
  )
  assert.ok(result)
  assert.equal(result.action, 'replaced')
  assert.equal(result.matchedCount, 1)
  assert.equal(result.holds.length, 2)
  assert.ok(result.holds.some((item) => item.id === 'neighbor'))
})

test('adds a new manual hold when the trace matches nothing', () => {
  const result = applyHoldOutline([hold('existing', 10, 10, 18, 18)], rectangle(70, 70, 82, 84), 1)
  assert.ok(result)
  assert.equal(result.action, 'added')
  assert.equal(result.holds.length, 2)
  assert.equal(result.holds[1].source, 'manual')
})

test('erases an outline touched by a short rub', () => {
  const result = eraseHoldsAlongPath(
    [hold('noise', 20, 20, 28, 28), hold('keep', 60, 60, 68, 68)],
    [{ x: 24, y: 24 }],
    1,
    1.5,
  )

  assert.deepEqual(result.removedIds, ['noise'])
  assert.deepEqual(result.holds.map((item) => item.id), ['keep'])
})

test('erases multiple separate outlines in one stroke', () => {
  const result = eraseHoldsAlongPath(
    [hold('noise-a', 15, 45, 21, 51), hold('noise-b', 75, 45, 81, 51)],
    [{ x: 10, y: 48 }, { x: 86, y: 48 }],
    1,
    1,
  )

  assert.deepEqual(new Set(result.removedIds), new Set(['noise-a', 'noise-b']))
  assert.equal(result.holds.length, 0)
})

test('prefers a hold over the volume behind it', () => {
  const volume = hold('volume', 10, 10, 90, 90)
  const mountedHold = hold('mounted-hold', 42, 42, 58, 58)
  const result = eraseHoldsAlongPath(
    [volume, mountedHold],
    [{ x: 50, y: 50 }],
    1,
    1,
  )

  assert.deepEqual(result.removedIds, ['mounted-hold'])
  assert.deepEqual(result.holds.map((item) => item.id), ['volume'])
})

test('keeps mounted holds when rubbing across a volume from an exposed area', () => {
  const volume = hold('volume', 10, 10, 90, 90)
  const mountedHold = hold('mounted-hold', 42, 42, 58, 58)
  const result = eraseHoldsAlongPath(
    [volume, mountedHold],
    [{ x: 20, y: 50 }, { x: 80, y: 50 }],
    1,
    1,
  )

  assert.deepEqual(result.removedIds, ['volume'])
  assert.deepEqual(result.holds.map((item) => item.id), ['mounted-hold'])
})
