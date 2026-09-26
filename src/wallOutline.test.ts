import assert from 'node:assert/strict'
import test from 'node:test'

import type { DetectedHold, Point } from './wallDetection'
import { applyHoldOutline, polygonArea, simplifyHoldOutline } from './wallOutline'

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
