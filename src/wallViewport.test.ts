import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clampWallPan,
  clampWallZoom,
  MAX_WALL_ZOOM,
  MIN_WALL_ZOOM,
  viewportPointToWallPercent,
  wheelWallZoom,
} from './wallViewport'

test('clamps wall zoom to the supported range', () => {
  assert.equal(clampWallZoom(0.5), MIN_WALL_ZOOM)
  assert.equal(clampWallZoom(2.25), 2.25)
  assert.equal(clampWallZoom(8), MAX_WALL_ZOOM)
})

test('centers the wall at 100% and clamps pan at higher zoom', () => {
  assert.deepEqual(clampWallPan({ x: 80, y: -50 }, 1, 400, 300), { x: 0, y: 0 })
  assert.deepEqual(clampWallPan({ x: 500, y: -500 }, 2, 400, 300), {
    x: 0,
    y: -300,
  })
})

test('maps a viewport tap back onto the wall after zooming and panning', () => {
  assert.deepEqual(
    viewportPointToWallPercent(
      { x: 150, y: 150 },
      { x: -50, y: -100 },
      2,
      400,
      200,
    ),
    { x: 25, y: 62.5 },
  )
})

test('only consumes wheel movement when the wall zoom can change', () => {
  assert.equal(wheelWallZoom(MIN_WALL_ZOOM, 100), MIN_WALL_ZOOM)
  assert.equal(wheelWallZoom(MAX_WALL_ZOOM, -100), MAX_WALL_ZOOM)
  assert.equal(wheelWallZoom(2, -100), 2.25)
  assert.equal(wheelWallZoom(2, 100), 1.75)
})
