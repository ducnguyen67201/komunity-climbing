import assert from 'node:assert/strict'
import test from 'node:test'

import {
  detectHoldRegionsFromPixels,
  mergeAiHoldDetections,
  type DetectedHold,
} from './wallDetection'

const WIDTH = 80
const HEIGHT = 60

function createWallPixels() {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const offset = pixel * 4
    data[offset] = 190
    data[offset + 1] = 180
    data[offset + 2] = 160
    data[offset + 3] = 255
  }
  return data
}

function paintRectangle(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: [number, number, number],
) {
  for (let currentY = y; currentY < y + height; currentY += 1) {
    for (let currentX = x; currentX < x + width; currentX += 1) {
      const offset = (currentY * WIDTH + currentX) * 4
      data[offset] = colour[0]
      data[offset + 1] = colour[1]
      data[offset + 2] = colour[2]
    }
  }
}

test('keeps nearby same-colour holds as separate regions', () => {
  const data = createWallPixels()
  paintRectangle(data, 12, 12, 6, 6, [35, 100, 220])
  paintRectangle(data, 19, 12, 6, 6, [35, 100, 220])

  const regions = detectHoldRegionsFromPixels(data, WIDTH, HEIGHT)
  const blueRegions = regions.filter(
    (region) => region.center.y >= 11 && region.center.y <= 19,
  )

  assert.equal(blueRegions.length, 2)
})

test('detects neutral white and grey holds against a beige wall', () => {
  const data = createWallPixels()
  paintRectangle(data, 10, 32, 7, 7, [245, 245, 240])
  paintRectangle(data, 35, 30, 8, 8, [92, 94, 91])

  const regions = detectHoldRegionsFromPixels(data, WIDTH, HEIGHT)

  assert.ok(regions.some((region) => region.center.x >= 9 && region.center.x <= 18))
  assert.ok(regions.some((region) => region.center.x >= 34 && region.center.x <= 44))
})

test('keeps holds mounted on a dark volume without selecting the volume', () => {
  const data = createWallPixels()
  paintRectangle(data, 8, 8, 48, 40, [28, 29, 31])
  paintRectangle(data, 14, 15, 8, 7, [166, 160, 174])
  paintRectangle(data, 35, 29, 9, 8, [75, 185, 105])

  const regions = detectHoldRegionsFromPixels(data, WIDTH, HEIGHT)

  assert.ok(regions.some((region) => region.center.x >= 13 && region.center.x <= 23))
  assert.ok(regions.some((region) => region.center.x >= 34 && region.center.x <= 45))
  assert.ok(regions.every((region) => region.area < WIDTH * HEIGHT * 0.022))
})

test('uses local polygons for AI matches and adds AI-only holds', () => {
  const local: DetectedHold[] = [{
    id: 'local-1',
    center: { x: 20, y: 20 },
    points: [{ x: 18, y: 18 }, { x: 22, y: 18 }, { x: 20, y: 22 }],
    role: null,
    source: 'detected',
  }]

  const merged = mergeAiHoldDetections(local, [
    {
      center: { x: 20, y: 20 },
      box: { left: 17, top: 17, right: 23, bottom: 23 },
      confidence: 95,
    },
    {
      center: { x: 70, y: 65 },
      box: { left: 66, top: 62, right: 74, bottom: 68 },
      confidence: 86,
    },
  ])

  assert.equal(merged.length, 2)
  assert.equal(merged.find((hold) => hold.id === 'local-1')?.source, 'ai')
  assert.ok(merged.some((hold) => hold.center.x === 70 && hold.source === 'ai'))
})
