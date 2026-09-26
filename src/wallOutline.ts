import type { DetectedHold, Point } from './wallDetection'

type CorrectionAction = 'added' | 'replaced' | 'merged'

export type HoldCorrection = {
  holds: DetectedHold[]
  action: CorrectionAction
  matchedCount: number
}

function clamp(value: number) {
  return Math.min(100, Math.max(0, value))
}

function scaledDistance(point: Point, start: Point, end: Point, aspectRatio: number) {
  const scaleY = 1 / Math.max(0.01, aspectRatio)
  const ax = start.x
  const ay = start.y * scaleY
  const bx = end.x
  const by = end.y * scaleY
  const px = point.x
  const py = point.y * scaleY
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const ratio = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy))
}

function rdp(points: Point[], epsilon: number, aspectRatio: number): Point[] {
  if (points.length <= 2) return points
  let maxDistance = 0
  let splitIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = scaledDistance(points[index], points[0], points.at(-1)!, aspectRatio)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = index
    }
  }
  if (maxDistance <= epsilon) return [points[0], points.at(-1)!]
  const left = rdp(points.slice(0, splitIndex + 1), epsilon, aspectRatio)
  const right = rdp(points.slice(splitIndex), epsilon, aspectRatio)
  return [...left.slice(0, -1), ...right]
}

export function polygonArea(points: Point[]) {
  if (points.length < 3) return 0
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2)
}

export function polygonCenter(points: Point[]): Point {
  let signedArea = 0
  let x = 0
  let y = 0
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const next = points[(index + 1) % points.length]
    const cross = point.x * next.y - next.x * point.y
    signedArea += cross
    x += (point.x + next.x) * cross
    y += (point.y + next.y) * cross
  }
  if (Math.abs(signedArea) < 0.0001) {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }
  return { x: x / (3 * signedArea), y: y / (3 * signedArea) }
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index]
    const b = polygon[previous]
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

export function simplifyHoldOutline(
  rawPoints: Point[],
  aspectRatio: number,
  maxPoints = 18,
): Point[] | null {
  const points = rawPoints
    .map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
    .filter((point, index, items) => {
      if (index === 0) return true
      return Math.hypot(point.x - items[index - 1].x, point.y - items[index - 1].y) >= 0.08
    })
  if (points.length < 3) return null

  let epsilon = 0.1
  let simplified = rdp(points, epsilon, aspectRatio)
  while (simplified.length > maxPoints && epsilon < 8) {
    epsilon *= 1.35
    simplified = rdp(points, epsilon, aspectRatio)
  }
  if (simplified.length > maxPoints) {
    const step = simplified.length / maxPoints
    simplified = Array.from({ length: maxPoints }, (_, index) => simplified[Math.floor(index * step)])
  }
  return simplified.length >= 3 && polygonArea(simplified) >= 0.12 ? simplified : null
}

export function applyHoldOutline(
  holds: DetectedHold[],
  rawPoints: Point[],
  aspectRatio: number,
): HoldCorrection | null {
  const points = simplifyHoldOutline(rawPoints, aspectRatio)
  if (!points) return null
  const center = polygonCenter(points)
  const candidates = holds
    .map((hold, index) => {
      const containedVertices = hold.points.filter((point) => pointInPolygon(point, points)).length
      const coverage = containedVertices / hold.points.length
      const centerInside = pointInPolygon(hold.center, points)
      return { hold, index, coverage, centerInside, distance: Math.hypot(hold.center.x - center.x, hold.center.y - center.y) }
    })
    .filter((match) => match.centerInside || match.coverage >= 0.5)
    .sort((a, b) => Number(b.centerInside) - Number(a.centerInside) || b.coverage - a.coverage || a.distance - b.distance)

  const primary = candidates[0]
  const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))
  const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))
  const outlineDiameter = Math.hypot(width, height / Math.max(0.01, aspectRatio))
  const mergeRadius = Math.min(8, Math.max(2.5, outlineDiameter * 0.42))
  const matches = primary
    ? candidates.filter((match) => match === primary || Math.hypot(
      match.hold.center.x - primary.hold.center.x,
      (match.hold.center.y - primary.hold.center.y) / Math.max(0.01, aspectRatio),
    ) <= mergeRadius)
    : []

  if (matches.length === 0) {
    return {
      holds: [...holds, { id: crypto.randomUUID(), points, center, role: null, source: 'manual' }],
      action: 'added',
      matchedCount: 0,
    }
  }

  const keeper = matches[0].hold
  const matchedIds = new Set(matches.map((match) => match.hold.id))
  const replacement: DetectedHold = {
    id: keeper.id,
    points,
    center,
    role: keeper.role,
    source: 'manual',
  }
  const firstIndex = Math.min(...matches.map((match) => match.index))
  const next = holds.filter((hold) => !matchedIds.has(hold.id))
  next.splice(firstIndex, 0, replacement)
  return {
    holds: next,
    action: matches.length > 1 ? 'merged' : 'replaced',
    matchedCount: matches.length,
  }
}
