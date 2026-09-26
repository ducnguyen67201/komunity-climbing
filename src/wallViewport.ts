export type ViewportPoint = {
  x: number
  y: number
}

export const MIN_WALL_ZOOM = 1
export const MAX_WALL_ZOOM = 4
export const WALL_ZOOM_STEP = 0.25

export function clampWallZoom(zoom: number) {
  return Math.min(MAX_WALL_ZOOM, Math.max(MIN_WALL_ZOOM, zoom))
}

export function wheelWallZoom(zoom: number, deltaY: number) {
  if (deltaY === 0) return zoom
  return clampWallZoom(zoom + (deltaY < 0 ? WALL_ZOOM_STEP : -WALL_ZOOM_STEP))
}

export function clampWallPan(
  pan: ViewportPoint,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): ViewportPoint {
  if (zoom <= MIN_WALL_ZOOM) return { x: 0, y: 0 }

  const minX = Math.min(0, canvasWidth - canvasWidth * zoom)
  const minY = Math.min(0, canvasHeight - canvasHeight * zoom)
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  }
}

export function viewportPointToWallPercent(
  point: ViewportPoint,
  pan: ViewportPoint,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): ViewportPoint {
  return {
    x: ((point.x - pan.x) / zoom / canvasWidth) * 100,
    y: ((point.y - pan.y) / zoom / canvasHeight) * 100,
  }
}
