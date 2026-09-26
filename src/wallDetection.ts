export type HoldRole = 'hand' | 'foot' | 'start' | 'finish'

export type Point = {
  x: number
  y: number
}

export type DetectedHold = {
  id: string
  points: Point[]
  center: Point
  role: HoldRole | null
  source: 'detected' | 'ai' | 'manual'
}

export type AiHoldDetection = {
  center: Point
  box: { left: number; top: number; right: number; bottom: number }
  confidence: number
}

export type WallFrame = {
  dataUrl: string
  width: number
  height: number
  sourceType: 'photo' | 'video' | 'demo'
}

const ANALYSIS_WIDTH = 360

function waitForEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(eventName, resolveEvent)
      target.removeEventListener('error', rejectEvent)
    }
    const resolveEvent = () => {
      cleanup()
      resolve()
    }
    const rejectEvent = () => {
      cleanup()
      reject(new Error('The selected file could not be read.'))
    }

    target.addEventListener(eventName, resolveEvent, { once: true })
    target.addEventListener('error', rejectEvent, { once: true })
  })
}

function canvasToFrame(
  canvas: HTMLCanvasElement,
  sourceType: WallFrame['sourceType'],
): WallFrame {
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    width: canvas.width,
    height: canvas.height,
    sourceType,
  }
}

function drawScaledFrame(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  sourceType: WallFrame['sourceType'],
) {
  const maxDimension = 1600
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available in this browser.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvasToFrame(canvas, sourceType)
}

export async function readWallAsset(file: File): Promise<WallFrame> {
  if (file.type.startsWith('video/')) {
    const video = document.createElement('video')
    const objectUrl = URL.createObjectURL(file)
    video.src = objectUrl
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'

    try {
      await waitForEvent(video, 'loadedmetadata')
      const targetTime = Number.isFinite(video.duration)
        ? Math.min(Math.max(video.duration * 0.45, 0), 2)
        : 0
      if (targetTime > 0) {
        video.currentTime = targetTime
        await waitForEvent(video, 'seeked')
      }
      return drawScaledFrame(
        video,
        video.videoWidth,
        video.videoHeight,
        'video',
      )
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Choose a photo or short video of a climbing wall.')
  }

  const image = new Image()
  const objectUrl = URL.createObjectURL(file)
  image.src = objectUrl
  try {
    await image.decode()
    return drawScaledFrame(image, image.naturalWidth, image.naturalHeight, 'photo')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function rgbToHsl(red: number, green: number, blue: number) {
  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return { hue: 0, saturation: 0, lightness }

  const delta = max - min
  let hue = 0
  if (max === r) hue = ((g - b) / delta) % 6
  else if (max === g) hue = (b - r) / delta + 2
  else hue = (r - g) / delta + 4

  return {
    hue: ((hue * 60 + 360) % 360) / 360,
    saturation: delta / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  }
}

function convexHull(points: Point[]) {
  if (points.length <= 3) return points
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) -
    (a.y - origin.y) * (b.x - origin.x)
  const lower: Point[] = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }
  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

function simplifyHull(points: Point[], maxPoints = 14) {
  if (points.length <= maxPoints) return points
  const step = points.length / maxPoints
  return Array.from({ length: maxPoints }, (_, index) =>
    points[Math.floor(index * step)],
  )
}

type DetectionRegion = {
  points: Point[]
  center: Point
  width: number
  height: number
  area: number
}

function estimateWallColour(data: Uint8ClampedArray) {
  const bins = new Map<number, { count: number; red: number; green: number; blue: number }>()

  for (let index = 0; index < data.length; index += 16) {
    const red = data[index]
    const green = data[index + 1]
    const blue = data[index + 2]
    const { saturation, lightness } = rgbToHsl(red, green, blue)
    if (saturation > 0.38 || lightness < 0.25 || lightness > 0.94) continue
    const key = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4)
    const bin = bins.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bin.count += 1
    bin.red += red
    bin.green += green
    bin.blue += blue
    bins.set(key, bin)
  }

  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0]
  if (!dominant) return { red: 180, green: 180, blue: 170 }
  return {
    red: dominant.red / dominant.count,
    green: dominant.green / dominant.count,
    blue: dominant.blue / dominant.count,
  }
}

function createDetectionMasks(
  data: Uint8ClampedArray,
  pixelCount: number,
  sensitivity: number,
) {
  // Narrower buckets stop a hold from merging into a similarly coloured volume.
  // Extra neutral buckets are especially useful for white and grey holds on black
  // volumes, where global wall-colour segmentation is not enough.
  const hueMasks = Array.from({ length: 12 }, () => new Uint8Array(pixelCount))
  const neutralMasks = Array.from({ length: 8 }, () => new Uint8Array(pixelCount))
  const wall = estimateWallColour(data)
  const saturationThreshold = 0.25 - sensitivity * 0.04
  const neutralDistanceThreshold = 38 - sensitivity * 5

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const dataIndex = pixel * 4
    const red = data[dataIndex]
    const green = data[dataIndex + 1]
    const blue = data[dataIndex + 2]
    const { hue, saturation, lightness } = rgbToHsl(red, green, blue)
    const channelRange = Math.max(red, green, blue) - Math.min(red, green, blue)

    if (
      saturation > saturationThreshold &&
      channelRange > 24 &&
      lightness > 0.055 &&
      lightness < 0.965
    ) {
      hueMasks[Math.min(11, Math.floor(hue * 12))][pixel] = 1
      continue
    }

    const redDistance = red - wall.red
    const greenDistance = green - wall.green
    const blueDistance = blue - wall.blue
    const colourDistance = Math.sqrt(
      redDistance * redDistance +
      greenDistance * greenDistance +
      blueDistance * blueDistance,
    )
    if (
      saturation < 0.3 &&
      colourDistance > neutralDistanceThreshold &&
      lightness > 0.045
    ) {
      neutralMasks[Math.min(7, Math.floor(lightness * 8))][pixel] = 1
    }
  }

  return [
    ...hueMasks.map((mask) => ({ mask, neutral: false })),
    ...neutralMasks.map((mask) => ({ mask, neutral: true })),
  ]
}

function extractRegions(
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  minimumArea: number,
  maximumArea: number,
): DetectionRegion[] {
  const pixelCount = imageWidth * imageHeight
  const visited = new Uint8Array(pixelCount)
  const regions: DetectionRegion[] = []

  for (let start = 0; start < pixelCount; start += 1) {
    if (!mask[start] || visited[start]) continue
    const queue = [start]
    visited[start] = 1
    const component: Point[] = []
    let cursor = 0
    let minX = imageWidth
    let maxX = 0
    let minY = imageHeight
    let maxY = 0

    while (cursor < queue.length) {
      const current = queue[cursor]
      cursor += 1
      const x = current % imageWidth
      const y = Math.floor(current / imageWidth)
      component.push({ x, y })
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)

      const neighbours = [
        x > 0 ? current - 1 : -1,
        x < imageWidth - 1 ? current + 1 : -1,
        y > 0 ? current - imageWidth : -1,
        y < imageHeight - 1 ? current + imageWidth : -1,
      ]
      for (const next of neighbours) {
        if (next < 0 || visited[next] || !mask[next]) continue
        visited[next] = 1
        queue.push(next)
      }
    }

    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const aspectRatio = Math.max(width / height, height / width)
    const fillRatio = component.length / (width * height)
    if (
      component.length < minimumArea ||
      component.length > maximumArea ||
      aspectRatio > 6 ||
      fillRatio < 0.12
    ) {
      continue
    }

    const boundary = component.filter(({ x, y }) =>
      x === 0 ||
      x === imageWidth - 1 ||
      y === 0 ||
      y === imageHeight - 1 ||
      !mask[y * imageWidth + x - 1] ||
      !mask[y * imageWidth + x + 1] ||
      !mask[(y - 1) * imageWidth + x] ||
      !mask[(y + 1) * imageWidth + x],
    )
    const hull = simplifyHull(convexHull(boundary.length ? boundary : component))
    const paddingX = Math.max(1, width * 0.06)
    const paddingY = Math.max(1, height * 0.06)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    regions.push({
      points: hull.map((point) => ({
        x: centerX + (point.x - centerX) * ((width + paddingX * 2) / width),
        y: centerY + (point.y - centerY) * ((height + paddingY * 2) / height),
      })),
      center: { x: centerX, y: centerY },
      width,
      height,
      area: component.length,
    })
  }

  return regions
}

export function detectHoldRegionsFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sensitivity = 1,
) {
  const pixelCount = width * height
  const minimumArea = Math.max(7, pixelCount * 0.000035)
  // Holds are small relative to a full wall image. Large connected components are
  // usually volumes, mats, people, or wall panels rather than selectable holds.
  const maximumArea = pixelCount * 0.022
  const regions = createDetectionMasks(data, pixelCount, sensitivity).flatMap(({ mask, neutral }) =>
    extractRegions(
      mask,
      width,
      height,
      neutral
        ? Math.max(minimumArea * 2.2, pixelCount * 0.00011)
        : minimumArea,
      maximumArea,
    ),
  )

  return regions
    .sort((a, b) => b.area - a.area)
    .filter((region, index, allRegions) => {
      const regionLeft = region.center.x - region.width / 2
      const regionRight = region.center.x + region.width / 2
      const regionTop = region.center.y - region.height / 2
      const regionBottom = region.center.y + region.height / 2

      return !allRegions.slice(0, index).some((larger) => {
        const overlapWidth = Math.max(
          0,
          Math.min(regionRight, larger.center.x + larger.width / 2) -
            Math.max(regionLeft, larger.center.x - larger.width / 2),
        )
        const overlapHeight = Math.max(
          0,
          Math.min(regionBottom, larger.center.y + larger.height / 2) -
            Math.max(regionTop, larger.center.y - larger.height / 2),
        )
        const overlap = overlapWidth * overlapHeight
        const smallerBoundsArea = Math.min(
          region.width * region.height,
          larger.width * larger.height,
        )
        return overlap / smallerBoundsArea > 0.58
      })
    })
}

export async function detectHolds(
  frame: WallFrame,
  sensitivity = 1,
): Promise<DetectedHold[]> {
  const image = new Image()
  image.src = frame.dataUrl
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = Math.min(ANALYSIS_WIDTH, frame.width)
  canvas.height = Math.max(1, Math.round((canvas.width / frame.width) * frame.height))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const regions = detectHoldRegionsFromPixels(data, canvas.width, canvas.height, sensitivity)
  const holds = regions.map<DetectedHold>((region) => ({
      id: crypto.randomUUID(),
      points: region.points.map((point) => ({
        x: (point.x / canvas.width) * 100,
        y: (point.y / canvas.height) * 100,
      })),
      center: {
        x: (region.center.x / canvas.width) * 100,
        y: (region.center.y / canvas.height) * 100,
      },
      role: null,
      source: 'detected',
    }))

  return holds
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
    .slice(0, 240)
}

export function createManualHold(center: Point, aspectRatio: number): DetectedHold {
  const radiusX = 3.2
  const radiusY = radiusX * aspectRatio
  const points = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2
    return {
      x: Math.max(0, Math.min(100, center.x + Math.cos(angle) * radiusX)),
      y: Math.max(0, Math.min(100, center.y + Math.sin(angle) * radiusY)),
    }
  })
  return {
    id: crypto.randomUUID(),
    points,
    center,
    role: null,
    source: 'manual',
  }
}

function createAiHold(detection: AiHoldDetection): DetectedHold {
  const { left, top, right, bottom } = detection.box
  const insetX = Math.max(0.35, (right - left) * 0.12)
  const insetY = Math.max(0.35, (bottom - top) * 0.12)
  return {
    id: crypto.randomUUID(),
    center: detection.center,
    points: [
      { x: left + insetX, y: top },
      { x: right - insetX, y: top },
      { x: right, y: top + insetY },
      { x: right, y: bottom - insetY },
      { x: right - insetX, y: bottom },
      { x: left + insetX, y: bottom },
      { x: left, y: bottom - insetY },
      { x: left, y: top + insetY },
    ],
    role: null,
    source: 'ai',
  }
}

export function mergeAiHoldDetections(
  localHolds: DetectedHold[],
  aiHolds: AiHoldDetection[],
) {
  const usedLocalIds = new Set<string>()
  const aiMapped = aiHolds.map((aiHold) => {
    const boxWidth = Math.max(1, aiHold.box.right - aiHold.box.left)
    const boxHeight = Math.max(1, aiHold.box.bottom - aiHold.box.top)
    const matchingLocal = localHolds
      .filter((hold) => {
        if (usedLocalIds.has(hold.id)) return false
        const marginX = boxWidth * 0.2
        const marginY = boxHeight * 0.2
        return (
          hold.center.x >= aiHold.box.left - marginX &&
          hold.center.x <= aiHold.box.right + marginX &&
          hold.center.y >= aiHold.box.top - marginY &&
          hold.center.y <= aiHold.box.bottom + marginY
        )
      })
      .sort((a, b) => {
        const aDistance = Math.hypot(a.center.x - aiHold.center.x, a.center.y - aiHold.center.y)
        const bDistance = Math.hypot(b.center.x - aiHold.center.x, b.center.y - aiHold.center.y)
        return aDistance - bDistance
      })[0]

    if (!matchingLocal) return createAiHold(aiHold)
    usedLocalIds.add(matchingLocal.id)
    return { ...matchingLocal, source: 'ai' as const }
  })

  return [...aiMapped, ...localHolds.filter((hold) => !usedLocalIds.has(hold.id))]
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x)
    .slice(0, 240)
}

function seededRandom(seed: number) {
  let value = seed % 2147483647
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export function createDemoWall(): WallFrame {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 1120
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available in this browser.')
  const random = seededRandom(207)

  const wallGradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
  wallGradient.addColorStop(0, '#d7d3c8')
  wallGradient.addColorStop(0.55, '#bbb8ae')
  wallGradient.addColorStop(1, '#98988f')
  context.fillStyle = wallGradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  context.strokeStyle = 'rgba(72, 72, 65, .2)'
  context.lineWidth = 3
  for (let x = 130; x < canvas.width; x += 215) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + 70, canvas.height)
    context.stroke()
  }

  context.fillStyle = 'rgba(55, 55, 50, .28)'
  for (let y = 52; y < canvas.height; y += 82) {
    for (let x = 50; x < canvas.width; x += 88) {
      context.beginPath()
      context.arc(x + (y % 3) * 9, y, 3.5, 0, Math.PI * 2)
      context.fill()
    }
  }

  const colours = ['#e94d35', '#f4b927', '#245dc1', '#6f3da7', '#e0659a', '#1a8f76']
  for (let index = 0; index < 76; index += 1) {
    const x = 48 + random() * (canvas.width - 96)
    const y = 42 + random() * (canvas.height - 84)
    const radiusX = 14 + random() * 27
    const radiusY = 10 + random() * 18
    const points = 7 + Math.floor(random() * 4)
    context.save()
    context.translate(x, y)
    context.rotate((random() - 0.5) * 2.4)
    context.beginPath()
    for (let point = 0; point < points; point += 1) {
      const angle = (point / points) * Math.PI * 2
      const variation = 0.82 + random() * 0.28
      const px = Math.cos(angle) * radiusX * variation
      const py = Math.sin(angle) * radiusY * variation
      if (point === 0) context.moveTo(px, py)
      else context.lineTo(px, py)
    }
    context.closePath()
    context.shadowColor = 'rgba(32, 31, 27, .45)'
    context.shadowBlur = 8
    context.shadowOffsetY = 6
    context.fillStyle = colours[Math.floor(random() * colours.length)]
    context.fill()
    context.shadowColor = 'transparent'
    context.strokeStyle = 'rgba(255,255,255,.24)'
    context.lineWidth = 2
    context.stroke()
    context.restore()
  }

  const vignette = context.createRadialGradient(450, 500, 180, 450, 500, 760)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(30,28,22,.24)')
  context.fillStyle = vignette
  context.fillRect(0, 0, canvas.width, canvas.height)

  return canvasToFrame(canvas, 'demo')
}
