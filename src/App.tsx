import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { signInWithGoogle, signOut } from './auth'
import { queryClient, trpc } from './trpc'
import {
  createDemoWall,
  detectHolds,
  mergeAiHoldDetections,
  readWallAsset,
  type DetectedHold,
  type HoldRole,
  type Point,
  type WallFrame,
} from './wallDetection'
import {
  clampWallPan,
  clampWallZoom,
  MAX_WALL_ZOOM,
  MIN_WALL_ZOOM,
  WALL_ZOOM_STEP,
  viewportPointToWallPercent,
  wheelWallZoom,
  type ViewportPoint,
} from './wallViewport'
import { applyHoldOutline, eraseHoldsAlongPath } from './wallOutline'

type DetectionMode = 'ai' | 'local'
type View = 'home' | 'source' | 'wall-editor' | 'wall-picker' | 'climb-editor' | 'library'
type EditableClimbStatus = 'draft' | 'submitted'
type ClimbStatus = EditableClimbStatus | 'changes_requested' | 'approved'
type ReviewDecision = 'approve' | 'request_changes'
type AuthUser = { name?: string | null; email?: string | null; image?: string | null }
type WallHold = Omit<DetectedHold, 'role'>
type WallRecord = {
  id: string
  name: string
  imageDataUrl: string
  imageWidth: number
  imageHeight: number
  sourceType: WallFrame['sourceType']
  holds: WallHold[]
  createdAt: string
  updatedAt: string
}
type ClimbRecord = {
  id: string
  wallId: string
  name: string
  grade: string
  assignments: Array<{ holdId: string; role: HoldRole }>
  ownerName: string
  wallName: string
  isOwner: boolean
  status: ClimbStatus
  review: {
    decision: ReviewDecision
    grade: string
    comment: string
    reviewerName: string
    reviewedAt: string
  } | null
  createdAt: string
  updatedAt: string
}

const grades = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+']
const climbStatusLabels: Record<ClimbStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}
const roleOptions: Array<{ id: HoldRole; label: string; hint: string }> = [
  { id: 'start', label: 'Start', hint: 'First move' },
  { id: 'hand', label: 'Hands', hint: 'Hand holds' },
  { id: 'foot', label: 'Feet', hint: 'Foot holds' },
  { id: 'finish', label: 'Finish', hint: 'Top hold' },
]
const ERASER_RADIUS_PX = 14

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    camera: <><path d="M14.5 4 16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2h5Z" /><circle cx="12" cy="13" r="4" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" /></>,
    scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 12h8" /></>,
    sparkles: <><path d="m12 3 .8 2.2A5 5 0 0 0 16 8.3l2 .7-2 .7a5 5 0 0 0-3.2 3.1L12 15l-.8-2.2A5 5 0 0 0 8 9.7L6 9l2-.7a5 5 0 0 0 3.2-3.1L12 3Z" /><path d="m5 14 .5 1.4A3.2 3.2 0 0 0 7.6 17l1.4.5-1.4.5a3.2 3.2 0 0 0-2.1 1.6L5 21l-.5-1.4A3.2 3.2 0 0 0 2.4 18L1 17.5l1.4-.5a3.2 3.2 0 0 0 2.1-1.6L5 14Z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    undo: <path d="m9 7-5 5 5 5M4 12h10a6 6 0 0 1 6 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>,
    play: <path d="m9 7 8 5-8 5V7Z" />,
    video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
    target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
    zoomIn: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4M8 11h6M11 8v6" /></>,
    zoomOut: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4M8 11h6" /></>,
    reset: <><path d="M4 8V4h4M20 16v4h-4" /><path d="M5.5 5.5A8 8 0 0 1 19 9M18.5 18.5A8 8 0 0 1 5 15" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m13.5 7.5 3 3" /></>,
    eraser: <><path d="m7.5 20.5-4-4a2.5 2.5 0 0 1 0-3.5l9.5-9.5a2.5 2.5 0 0 1 3.5 0l4 4a2.5 2.5 0 0 1 0 3.5l-9.5 9.5H7.5Z" /><path d="m9 7.5 7.5 7.5M7.5 20.5H21" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></>,
    book: <><path d="M4 5a3 3 0 0 1 3-2h5v17H7a3 3 0 0 0-3 2V5Z" /><path d="M20 5a3 3 0 0 0-3-2h-5v17h5a3 3 0 0 1 3 2V5Z" /></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function Brand() {
  return <div className="brand" aria-label="Crux climbing"><img className="brand-mark" src="/crux-mark.svg" alt="" /><span>CRUX</span></div>
}

function AuthMessage({ title, detail }: { title: string; detail?: string }) {
  return <main className="auth-shell"><section className="login-card"><Brand /><p className="eyebrow">Komunity climbing</p><h1>{title}</h1>{detail && <p className="error">{detail}</p>}</section></main>
}

function LoginScreen({ configured, apiOnline, pending, error, onSignIn }: { configured: boolean; apiOnline: boolean; pending: boolean; error: string | null; onSignIn: () => void }) {
  return (
    <main className="auth-shell"><section className="login-card"><Brand /><p className="eyebrow">Komunity climbing</p><h1>Set routes together.</h1><p className="lede">Sign in to scan walls, map holds, and set climbs together.</p><button className="google-button" type="button" disabled={pending || !configured} onClick={onSignIn}><span aria-hidden="true">G</span>{pending ? 'Opening Google…' : 'Continue with Google'}</button>{!configured && <aside className="setup-notice" role="status">Google authentication is not configured for this environment.</aside>}{error && <p className="error" role="alert">{error}</p>}<div className="login-status" aria-live="polite"><span className={`api-light${apiOnline ? ' online' : ''}`} />{apiOnline ? 'API connected' : 'API offline'}</div></section></main>
  )
}

function WallViewport({ frame, holds, correctionMode = null, onHoldTap, onDrawHold, onEraseStroke, instruction }: { frame: WallFrame; holds: DetectedHold[]; correctionMode?: 'draw' | 'erase' | null; onHoldTap: (id: string) => void; onDrawHold?: (points: Point[]) => void; onEraseStroke?: (points: Point[], brushRadius: number) => void; instruction: string }) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const activePointers = useRef(new Map<number, ViewportPoint>())
  const viewRef = useRef({ zoom: MIN_WALL_ZOOM, pan: { x: 0, y: 0 } })
  const gestureRef = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, lastDistance: 0, lastMidpoint: { x: 0, y: 0 }, moved: false, holdId: null as string | null })
  const draftRef = useRef<Point[]>([])
  const [zoom, setZoom] = useState(MIN_WALL_ZOOM)
  const [pan, setPan] = useState<ViewportPoint>({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [draftPoints, setDraftPoints] = useState<Point[]>([])
  const drawMode = correctionMode === 'draw'
  const eraseMode = correctionMode === 'erase'

  function wallPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    const point = viewportPointToWallPercent(
      { x: clientX - bounds.left, y: clientY - bounds.top },
      viewRef.current.pan,
      viewRef.current.zoom,
      canvas.clientWidth,
      canvas.clientHeight,
    )
    if (point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100) return null
    return point
  }

  function setDraft(points: Point[]) {
    draftRef.current = points
    setDraftPoints(points)
  }

  function applyViewport(nextZoom: number, nextPan: ViewportPoint) {
    const canvas = canvasRef.current
    const clampedZoom = clampWallZoom(nextZoom)
    const clampedPan = clampWallPan(nextPan, clampedZoom, canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0)
    viewRef.current = { zoom: clampedZoom, pan: clampedPan }
    setZoom(clampedZoom)
    setPan(clampedPan)
  }

  function zoomAt(nextZoom: number, focalPoint?: ViewportPoint) {
    const canvas = canvasRef.current
    if (!canvas) return
    const current = viewRef.current
    const clampedZoom = clampWallZoom(nextZoom)
    const focal = focalPoint ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }
    const worldX = (focal.x - current.pan.x) / current.zoom
    const worldY = (focal.y - current.pan.y) / current.zoom
    applyViewport(clampedZoom, { x: focal.x - worldX * clampedZoom, y: focal.y - worldY * clampedZoom })
  }

  function endPointer(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!activePointers.current.has(event.pointerId)) return
    const gesture = gestureRef.current
    const finishingCorrection = Boolean(correctionMode) && activePointers.current.size === 1 && draftRef.current.length > 0
    const isTap = !cancelled && activePointers.current.size === 1 && !gesture.moved
    const holdId = gesture.holdId
    activePointers.current.delete(event.pointerId)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const remaining = [...activePointers.current.values()][0]
    if (remaining) {
      Object.assign(gesture, { startX: remaining.x, startY: remaining.y, lastX: remaining.x, lastY: remaining.y, moved: true })
    } else setIsPanning(false)
    if (finishingCorrection) {
      const completed = draftRef.current
      const canvasWidth = Math.max(1, canvasRef.current?.clientWidth ?? 1)
      const brushRadius = (ERASER_RADIUS_PX / (canvasWidth * viewRef.current.zoom)) * 100
      setDraft([])
      if (!cancelled && drawMode && onDrawHold) onDrawHold(completed)
      if (!cancelled && eraseMode && onEraseStroke) onEraseStroke(completed, brushRadius)
      return
    }
    if (isTap && holdId && !correctionMode) onHoldTap(holdId)
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (activePointers.current.size === 1) {
      if (correctionMode) {
        const point = wallPoint(event.clientX, event.clientY)
        if (point) setDraft([point])
        Object.assign(gesture, { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: true, holdId: null })
        return
      }
      const target = (event.target as Element).closest<SVGGElement>('[data-hold-id]')
      Object.assign(gesture, { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, holdId: target?.dataset.holdId ?? null })
      return
    }
    if (draftRef.current.length) setDraft([])
    const points = [...activePointers.current.values()].slice(0, 2)
    gesture.moved = true
    gesture.lastDistance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
    gesture.lastMidpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
    setIsPanning(true)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!activePointers.current.has(event.pointerId)) return
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const gesture = gestureRef.current
    if (activePointers.current.size >= 2) {
      const points = [...activePointers.current.values()].slice(0, 2)
      const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
      const midpoint = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
      const bounds = event.currentTarget.getBoundingClientRect()
      const current = viewRef.current
      const previousFocal = { x: gesture.lastMidpoint.x - bounds.left, y: gesture.lastMidpoint.y - bounds.top }
      const nextFocal = { x: midpoint.x - bounds.left, y: midpoint.y - bounds.top }
      const nextZoom = clampWallZoom(current.zoom * (gesture.lastDistance > 0 ? distance / gesture.lastDistance : 1))
      const worldX = (previousFocal.x - current.pan.x) / current.zoom
      const worldY = (previousFocal.y - current.pan.y) / current.zoom
      applyViewport(nextZoom, { x: nextFocal.x - worldX * nextZoom, y: nextFocal.y - worldY * nextZoom })
      gesture.lastDistance = distance
      gesture.lastMidpoint = midpoint
      gesture.moved = true
      setIsPanning(true)
      return
    }
    if (correctionMode && draftRef.current.length > 0) {
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
      const next = [...draftRef.current]
      for (const sample of samples) {
        const point = wallPoint(sample.clientX, sample.clientY)
        const previous = next.at(-1)
        if (point && (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.08)) next.push(point)
      }
      setDraft(next)
      return
    }
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) gesture.moved = true
    if (!gesture.moved || viewRef.current.zoom <= MIN_WALL_ZOOM) return
    const current = viewRef.current
    applyViewport(current.zoom, { x: current.pan.x + event.clientX - gesture.lastX, y: current.pan.y + event.clientY - gesture.lastY })
    gesture.lastX = event.clientX
    gesture.lastY = event.clientY
    setIsPanning(true)
  }

  const previewRadius = (ERASER_RADIUS_PX / (Math.max(1, canvasRef.current?.clientWidth ?? 1) * zoom)) * 100
  const draftPath = draftPoints.map(({ x, y }) => `${x},${y}`).join(' ')

  function wheel(event: WheelEvent<HTMLDivElement>) {
    const nextZoom = wheelWallZoom(viewRef.current.zoom, event.deltaY)
    if (nextZoom === viewRef.current.zoom) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    zoomAt(nextZoom, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = viewRef.current
    if (event.key === 'Escape' && draftRef.current.length > 0) { event.preventDefault(); setDraft([]) }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomAt(current.zoom + WALL_ZOOM_STEP) }
    else if (event.key === '-') { event.preventDefault(); zoomAt(current.zoom - WALL_ZOOM_STEP) }
    else if (event.key === '0') { event.preventDefault(); applyViewport(1, { x: 0, y: 0 }) }
    else if (current.zoom > 1 && event.key.startsWith('Arrow')) {
      event.preventDefault()
      applyViewport(current.zoom, { x: current.pan.x + (event.key === 'ArrowLeft' ? 38 : event.key === 'ArrowRight' ? -38 : 0), y: current.pan.y + (event.key === 'ArrowUp' ? 38 : event.key === 'ArrowDown' ? -38 : 0) })
    }
  }

  return (
    <div className="wall-canvas-wrap"><div ref={canvasRef} className={`wall-canvas${drawMode ? ' drawing' : ''}${eraseMode ? ' erasing' : ''}${zoom > 1 ? ' zoomed' : ''}${isPanning ? ' panning' : ''}`} style={{ aspectRatio: `${frame.width} / ${frame.height}` }} role="region" aria-label={`Climbing wall. ${instruction}`} aria-keyshortcuts="= - 0 Escape ArrowUp ArrowDown ArrowLeft ArrowRight" tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={endPointer} onPointerCancel={(event) => endPointer(event, true)} onLostPointerCapture={(event) => endPointer(event, true)} onWheel={wheel} onKeyDown={keyDown}>
      <div className="wall-stage" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }}><img src={frame.dataUrl} alt="Scanned climbing wall" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Mapped climbing holds">{holds.map((hold, index) => { const points = hold.points.map(({ x, y }) => `${x},${y}`).join(' '); return <g key={hold.id} className={hold.role ? `selected-hold role-${hold.role}` : 'candidate-hold'} data-hold-id={hold.id} role="button" tabIndex={correctionMode ? -1 : 0} aria-label={`${hold.role ? `${hold.role} hold` : 'Mapped hold'} ${index + 1}`} aria-pressed={Boolean(hold.role)} onKeyDown={(event) => { if (!correctionMode && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onHoldTap(hold.id) } }}><polygon className="hold-hit-area" points={points} />{hold.role && <polygon className="hold-halo" points={points} />}<polygon className="hold-shape" points={points} />{hold.role && <circle className="hold-marker" cx={hold.center.x} cy={hold.center.y} r="1.25" />}</g> })}{drawMode && draftPoints.length > 1 && <polygon className="draft-hold-shape" points={draftPath} />}{eraseMode && draftPoints.length > 0 && <g className="eraser-preview"><polyline points={draftPath} style={{ strokeWidth: ERASER_RADIUS_PX * 2 }} /><ellipse cx={draftPoints.at(-1)!.x} cy={draftPoints.at(-1)!.y} rx={previewRadius} ry={previewRadius * (frame.width / frame.height)} /></g>}</svg></div>
      <div className="zoom-controls" role="group" aria-label="Wall zoom controls" onPointerDown={(event) => event.stopPropagation()}><button type="button" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomAt(viewRef.current.zoom - WALL_ZOOM_STEP)}><Icon name="zoomOut" size={17} /></button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" aria-label="Zoom in" disabled={zoom >= MAX_WALL_ZOOM} onClick={() => zoomAt(viewRef.current.zoom + WALL_ZOOM_STEP)}><Icon name="zoomIn" size={17} /></button><button type="button" aria-label="Reset zoom" disabled={zoom <= 1 && pan.x === 0 && pan.y === 0} onClick={() => applyViewport(1, { x: 0, y: 0 })}><Icon name="reset" size={16} /></button></div>
      {drawMode && <div className="add-instruction"><Icon name="edit" size={16} /> Draw around the whole hold · lift to close</div>}
      {eraseMode && <div className="add-instruction erase"><Icon name="eraser" size={16} /> Rub over wrong outlines · lift to erase</div>}
    </div></div>
  )
}

function CreateHome({ wallCount, onAddWall, onSetClimb }: { wallCount: number; onAddWall: () => void; onSetClimb: () => void }) {
  return <section className="create-home"><div className="create-copy"><p className="eyebrow">Create</p><h1>What are we setting?</h1><p>Save a wall once. Reuse it for every climb you set there.</p><div className="choice-stack"><button className="choice-card primary" type="button" onClick={onAddWall}><span><Icon name="plus" /><b>Add a wall</b><small>Scan, check the holds, and save it</small></span><Icon name="arrow" /></button><button className="choice-card" type="button" onClick={onSetClimb}><span><Icon name="target" /><b>Set a climb</b><small>{wallCount ? `Choose from ${wallCount} saved wall${wallCount === 1 ? '' : 's'}` : 'Add a wall first'}</small></span><Icon name="arrow" /></button></div></div><div className="topo-hero" aria-hidden="true"><span className="topo-label">SAVE THE WALL</span><div className="topo-line" /><strong>SET<br />MANY<br />CLIMBS</strong></div></section>
}

function WallSource({ onCamera, onRecord, onUpload, onDemo, onCancel }: { onCamera: () => void; onRecord: () => void; onUpload: () => void; onDemo: () => void; onCancel: () => void }) {
  return <section className="simple-form-shell"><header className="form-heading"><button className="text-button" type="button" onClick={onCancel}>← Cancel</button><p className="eyebrow">New wall</p><h1>Add a wall</h1><p>One clear photo is enough. You can correct any missed holds next.</p></header><div className="source-sheet"><button className="source-row primary" type="button" onClick={onCamera}><span className="source-icon"><Icon name="camera" /></span><span><strong>Take a photo</strong><small>Use your phone camera</small></span><Icon name="arrow" /></button><button className="source-row" type="button" onClick={onRecord}><span className="source-icon"><Icon name="video" /></span><span><strong>Record the wall</strong><small>Use a short video frame</small></span><Icon name="arrow" /></button><button className="source-row" type="button" onClick={onUpload}><span className="source-icon"><Icon name="upload" /></span><span><strong>Upload a file</strong><small>Choose a photo or video</small></span><Icon name="arrow" /></button><button className="demo-row" type="button" onClick={onDemo}><Icon name="play" /> Try a sample wall</button></div></section>
}

function WallForm({ frame, initialHolds, initialName, detectionMode, editing, pending, error, onCancel, onSave }: { frame: WallFrame; initialHolds: DetectedHold[]; initialName: string; detectionMode: DetectionMode; editing: boolean; pending: boolean; error?: string; onCancel: () => void; onSave: (name: string, holds: DetectedHold[]) => void }) {
  const [holds, setHolds] = useState<DetectedHold[]>(
    initialHolds.map((hold) => ({ ...hold, role: null })),
  )
  const [history, setHistory] = useState<DetectedHold[][]>([])
  const [correctionTool, setCorrectionTool] = useState<'draw' | 'erase' | null>(null)
  const [correctionStatus, setCorrectionStatus] = useState('')
  const [name, setName] = useState(initialName)
  const commit = (next: DetectedHold[]) => { setHistory((current) => [...current.slice(-19), holds]); setHolds(next) }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setHolds(previous); setHistory((current) => current.slice(0, -1)) }
  const drawOutline = (points: Point[]) => {
    const correction = applyHoldOutline(holds, points, frame.width / frame.height)
    if (!correction) {
      setCorrectionStatus('Outline is too small. Draw around the whole hold.')
      return
    }
    commit(correction.holds)
    setCorrectionStatus(
      correction.action === 'added'
        ? 'Hold added.'
        : correction.action === 'merged'
          ? `${correction.matchedCount} partial outlines merged into one hold.`
          : 'Hold outline fixed.',
    )
  }
  const eraseStroke = (points: Point[], brushRadius: number) => {
    const erasure = eraseHoldsAlongPath(
      holds,
      points,
      frame.width / frame.height,
      brushRadius,
    )
    if (erasure.removedIds.length === 0) {
      setCorrectionStatus('No outline under the eraser.')
      return
    }
    commit(erasure.holds)
    setCorrectionStatus(
      `${erasure.removedIds.length} outline${erasure.removedIds.length === 1 ? '' : 's'} erased.`,
    )
  }
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(name, holds) }
  const drawMode = correctionTool === 'draw'
  const eraseMode = correctionTool === 'erase'
  return <section className="flow-shell"><header className="flow-heading"><div><button className="text-button" type="button" onClick={onCancel}>← Cancel</button><p className="eyebrow">{editing ? 'Edit wall' : 'New wall'}</p><h1>{editing ? 'Update this wall' : 'Make this wall reusable'}</h1></div><span className="mapped-pill"><span />{holds.length} holds · {detectionMode === 'ai' ? 'AI assisted' : 'local scan'}</span></header><div className="wall-form-grid"><div className="wall-step"><div className="step-copy"><span>1</span><div><h2>Check the holds</h2><p>Draw around missed holds, or rub the eraser over noisy outlines. Volumes stay part of the wall.</p></div></div><div className="correction-tools"><button className={drawMode ? 'active' : ''} type="button" aria-pressed={drawMode} onClick={() => { setCorrectionTool((current) => current === 'draw' ? null : 'draw'); setCorrectionStatus('') }}><Icon name="edit" /> Draw outline</button><button className={eraseMode ? 'active' : ''} type="button" aria-pressed={eraseMode} onClick={() => { setCorrectionTool((current) => current === 'erase' ? null : 'erase'); setCorrectionStatus('') }}><Icon name="eraser" /> Eraser</button><button type="button" disabled={!history.length} onClick={() => { undo(); setCorrectionStatus('Last correction undone.') }}><Icon name="undo" /> Undo</button><span className="correction-status" aria-live="polite">{correctionStatus}</span></div><WallViewport frame={frame} holds={holds} correctionMode={correctionTool} instruction={drawMode ? 'Draw around the whole hold. Lift to close the outline. Use two fingers to zoom or move.' : eraseMode ? 'Rub over incorrect outlines. Lift to erase them.' : 'Choose Draw outline or Eraser to correct the scan.'} onHoldTap={() => {}} onDrawHold={drawOutline} onEraseStroke={eraseStroke} /></div><form className="name-card" onSubmit={submit}><span className="tape-label">2 · Name this wall</span><label>Wall name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. North cave" maxLength={80} required autoFocus /></label><p>This is the name setters will choose when they create a climb.</p>{error && <p className="error" role="alert">{error}</p>}<button className="chalk-action" type="submit" disabled={pending || holds.length === 0}>{pending ? 'Saving wall…' : editing ? 'Save changes' : 'Save wall'}<Icon name="arrow" /></button></form></div></section>
}

function WallPicker({ walls, onChoose, onAdd, onCancel }: { walls: WallRecord[]; onChoose: (wall: WallRecord) => void; onAdd: () => void; onCancel: () => void }) {
  return <section className="simple-form-shell wide"><header className="form-heading"><button className="text-button" type="button" onClick={onCancel}>← Cancel</button><p className="eyebrow">New climb</p><h1>Choose a wall</h1><p>The climb will use this wall’s mapped holds.</p></header>{walls.length ? <div className="wall-picker-list">{walls.map((wall) => <button className="wall-pick-row" type="button" key={wall.id} onClick={() => onChoose(wall)}><img src={wall.imageDataUrl} alt="" /><span><strong>{wall.name}</strong><small>{wall.holds.length} mapped holds</small></span><Icon name="arrow" /></button>)}</div> : <div className="empty-book"><Icon name="image" size={34} /><h2>No walls yet</h2><p>Scan your first wall before setting a climb.</p><button className="chalk-action" type="button" onClick={onAdd}>Add a wall <Icon name="arrow" /></button></div>}</section>
}

function ClimbForm({
  wall,
  climb,
  pending,
  error,
  onCancel,
  onSave,
}: {
  wall: WallRecord
  climb?: ClimbRecord
  pending: boolean
  error?: string
  onCancel: () => void
  onSave: (details: {
    name: string
    grade: string
    assignments: Array<{ holdId: string; role: HoldRole }>
    status: EditableClimbStatus
  }) => void
}) {
  const assignments = new Map(
    climb?.assignments.map((assignment) => [assignment.holdId, assignment.role]),
  )
  const [holds, setHolds] = useState<DetectedHold[]>(
    wall.holds.map((hold) => ({
      ...hold,
      role: assignments.get(hold.id) ?? null,
    })),
  )
  const [history, setHistory] = useState<DetectedHold[][]>([])
  const [activeRole, setActiveRole] = useState<HoldRole>('hand')
  const [name, setName] = useState(climb?.name ?? '')
  const [grade, setGrade] = useState(climb?.grade ?? 'V3')
  const [publishError, setPublishError] = useState('')
  const selected = holds.filter(
    (hold): hold is DetectedHold & { role: HoldRole } => Boolean(hold.role),
  )
  const counts = useMemo(
    () =>
      Object.fromEntries(
        roleOptions.map((option) => [
          option.id,
          holds.filter((hold) => hold.role === option.id).length,
        ]),
      ) as Record<HoldRole, number>,
    [holds],
  )
  const canPublish =
    Boolean(name.trim()) &&
    Boolean(grade.trim()) &&
    selected.length >= 2 &&
    counts.start > 0 &&
    counts.finish > 0

  function details(status: EditableClimbStatus) {
    return {
      name,
      grade,
      assignments: selected.map((hold) => ({
        holdId: hold.id,
        role: hold.role,
      })),
      status,
    }
  }

  function commit(next: DetectedHold[]) {
    setHistory((current) => [...current.slice(-19), holds])
    setHolds(next)
    setPublishError('')
  }

  function publish(event: FormEvent) {
    event.preventDefault()
    if (!canPublish) {
      setPublishError(
        'Complete the name, grade, start, finish, and at least two holds before publishing.',
      )
      return
    }
    onSave(details('submitted'))
  }

  return (
    <section className="flow-shell">
      <header className="flow-heading compact">
        <div>
          <button className="text-button" type="button" onClick={onCancel}>
            ← Cancel
          </button>
          <p className="eyebrow">
            {climb ? 'Edit climb' : 'New climb'} · {wall.name}
          </p>
          <h1>{climb ? 'Update your climb' : 'Set a climb'}</h1>
        </div>
        <span className="mapped-pill">
          <span />
          {selected.length} marked
        </span>
      </header>
      <form onSubmit={publish}>
        <div className="climb-details-strip">
          <label>
            Climb name
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setPublishError('')
              }}
              placeholder="e.g. Paper Tiger"
              maxLength={80}
            />
          </label>
          <label>
            Grade
            <select
              value={grade}
              onChange={(event) => {
                setGrade(event.target.value)
                setPublishError('')
              }}
            >
              {grades.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="climb-canvas-card">
          <div className="chalkline-rail" role="radiogroup" aria-label="Hold role">
            {roleOptions.map((option) => (
              <button
                className={`role-${option.id}${activeRole === option.id ? ' active' : ''}`}
                type="button"
                role="radio"
                aria-checked={activeRole === option.id}
                key={option.id}
                onClick={() => setActiveRole(option.id)}
              >
                <span className="role-swatch" />
                <span>
                  <b>{option.label}</b>
                  <small>{counts[option.id]}</small>
                </span>
              </button>
            ))}
            <button
              className="rail-undo"
              type="button"
              disabled={!history.length}
              onClick={() => {
                const previous = history.at(-1)
                if (previous) {
                  setHolds(previous)
                  setHistory((current) => current.slice(0, -1))
                  setPublishError('')
                }
              }}
            >
              <Icon name="undo" />
              <span>Undo</span>
            </button>
          </div>
          <WallViewport
            frame={{
              dataUrl: wall.imageDataUrl,
              width: wall.imageWidth,
              height: wall.imageHeight,
              sourceType: wall.sourceType,
            }}
            holds={holds}
            instruction={`Choose a role, then tap holds on ${wall.name}.`}
            onHoldTap={(id) =>
              commit(
                holds.map((hold) =>
                  hold.id === id
                    ? {
                        ...hold,
                        role: hold.role === activeRole ? null : activeRole,
                      }
                    : hold,
                ),
              )
            }
          />
        </div>
        <div className="chalkline-submit">
          <div>
            <strong>{selected.length} holds marked</strong>
            <span>
              {counts.start} start · {counts.hand} hands · {counts.foot} feet ·{' '}
              {counts.finish} finish
            </span>
          </div>
          <div className="climb-save-actions">
            <button
              className="secondary-action"
              type="button"
              disabled={pending}
              onClick={() => onSave(details('draft'))}
            >
              {pending ? 'Saving…' : 'Save draft'}
            </button>
            <button className="chalk-action" type="submit" disabled={pending}>
              {pending
                ? 'Publishing…'
                : climb
                  ? 'Update & publish'
                  : 'Publish for review'}
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        {(publishError || error) && (
          <p className="form-hint form-error" role="alert">
            {publishError || error}
          </p>
        )}
        {!canPublish && !publishError && !error && (
          <p className="form-hint">
            Drafts can be incomplete. Publishing requires a name, grade, one start,
            one finish, and at least two holds.
          </p>
        )}
      </form>
    </section>
  )
}

function ReviewCard({
  climb,
  pending,
  error,
  onReview,
}: {
  climb: ClimbRecord
  pending: boolean
  error?: string
  onReview: (decision: ReviewDecision, grade: string, comment: string) => void
}) {
  const [grade, setGrade] = useState(climb.grade)
  const [comment, setComment] = useState('')

  return (
    <article className="review-card">
      <header>
        <div>
          <span className="climb-status status-submitted">Awaiting review</span>
          <h3>{climb.name}</h3>
          <p>
            {climb.ownerName} · {climb.wallName} · {climb.assignments.length} holds
          </p>
        </div>
        <strong>{climb.grade}</strong>
      </header>
      <div className="review-fields">
        <label>
          Reviewed grade
          <select value={grade} onChange={(event) => setGrade(event.target.value)}>
            {grades.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Feedback
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Optional notes for the setter"
            maxLength={500}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="review-actions">
        <button
          className="secondary-action request-action"
          type="button"
          disabled={pending}
          onClick={() => onReview('request_changes', grade, comment)}
        >
          Request changes
        </button>
        <button
          className="chalk-action"
          type="button"
          disabled={pending}
          onClick={() => onReview('approve', grade, comment)}
        >
          {pending ? 'Saving review…' : 'Approve grade'}
        </button>
      </div>
    </article>
  )
}

function TopoBook({
  walls,
  climbs,
  notice,
  canReview,
  reviewTargetId,
  reviewPending,
  reviewError,
  onAddWall,
  onSetClimb,
  onEditWall,
  onDeleteWall,
  onEditClimb,
  onDeleteClimb,
  onReview,
}: {
  walls: WallRecord[]
  climbs: ClimbRecord[]
  notice: string
  canReview: boolean
  reviewTargetId?: string
  reviewPending: boolean
  reviewError?: string
  onAddWall: () => void
  onSetClimb: (wall: WallRecord) => void
  onEditWall: (wall: WallRecord) => void
  onDeleteWall: (wall: WallRecord) => void
  onEditClimb: (climb: ClimbRecord) => void
  onDeleteClimb: (climb: ClimbRecord) => void
  onReview: (
    climb: ClimbRecord,
    decision: ReviewDecision,
    grade: string,
    comment: string,
  ) => void
}) {
  const reviewQueue = climbs.filter(
    (climb) => !climb.isOwner && climb.status === 'submitted',
  )

  return (
    <section className="topo-book">
      <header className="book-heading">
        <div>
          <p className="eyebrow">Topo book</p>
          <h1>Your walls</h1>
          <p>Each wall keeps its map and all the climbs set on it.</p>
        </div>
        <button className="chalk-action" type="button" onClick={onAddWall}>
          <Icon name="plus" /> Add wall
        </button>
      </header>
      {notice && (
        <div className="save-receipt" role="status">
          <Icon name="check" />
          {notice}
        </div>
      )}
      {canReview && reviewQueue.length > 0 && (
        <section className="review-queue" aria-labelledby="review-queue-title">
          <header>
            <div>
              <p className="eyebrow">Coach review</p>
              <h2 id="review-queue-title">Published climbs</h2>
            </div>
            <span>{reviewQueue.length} waiting</span>
          </header>
          <div className="review-grid">
            {reviewQueue.map((climb) => (
              <ReviewCard
                key={climb.id}
                climb={climb}
                pending={reviewPending && reviewTargetId === climb.id}
                error={reviewTargetId === climb.id ? reviewError : undefined}
                onReview={(decision, grade, comment) =>
                  onReview(climb, decision, grade, comment)
                }
              />
            ))}
          </div>
        </section>
      )}
      {walls.length === 0 ? (
        <div className="empty-book">
          <Icon name="book" size={38} />
          <h2>No walls in your book yet</h2>
          <p>Add a wall once, then reuse it for every climb.</p>
          <button className="chalk-action" type="button" onClick={onAddWall}>
            Add your first wall <Icon name="arrow" />
          </button>
        </div>
      ) : (
        <div className="topo-list">
          {walls.map((wall) => {
            const wallClimbs = climbs.filter(
              (climb) => climb.isOwner && climb.wallId === wall.id,
            )
            return (
              <article className="topo-wall" key={wall.id}>
                <div className="wall-spine">
                  <img src={wall.imageDataUrl} alt={`${wall.name} wall`} />
                  <span>{wall.name}</span>
                </div>
                <div className="wall-book-content">
                  <header>
                    <div>
                      <h2>{wall.name}</h2>
                      <p>
                        {wall.holds.length} holds · {wallClimbs.length} climb
                        {wallClimbs.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="crud-actions">
                      <button type="button" onClick={() => onEditWall(wall)}>
                        <Icon name="edit" /> Edit wall
                      </button>
                      <button
                        className="danger"
                        type="button"
                        aria-label={`Delete ${wall.name}`}
                        onClick={() => onDeleteWall(wall)}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  </header>
                  <div className="climb-rows">
                    {wallClimbs.map((climb) => (
                      <div className="climb-row" key={climb.id}>
                        <span>
                          <strong>{climb.name || 'Untitled draft'}</strong>
                          <small>
                            {climb.assignments.length} marked holds ·{' '}
                            <span className={`climb-status status-${climb.status}`}>
                              {climbStatusLabels[climb.status]}
                            </span>
                          </small>
                          {climb.review?.comment && (
                            <small className="review-comment">
                              {climb.review.reviewerName}: {climb.review.comment}
                            </small>
                          )}
                        </span>
                        <b>
                          {climb.status === 'approved' && climb.review
                            ? climb.review.grade
                            : climb.grade || '—'}
                        </b>
                        {climb.status !== 'approved' ? (
                          <button type="button" onClick={() => onEditClimb(climb)}>
                            <Icon name="edit" /> Edit
                          </button>
                        ) : (
                          <span className="reviewed-label">Reviewed</span>
                        )}
                        <button
                          className="icon-danger"
                          type="button"
                          aria-label={`Delete ${climb.name || 'draft climb'}`}
                          onClick={() => onDeleteClimb(climb)}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    ))}
                    {wallClimbs.length === 0 && (
                      <p className="no-climbs">No climbs here yet.</p>
                    )}
                  </div>
                  <button
                    className="set-on-wall"
                    type="button"
                    onClick={() => onSetClimb(wall)}
                  >
                    <Icon name="plus" /> Set a climb on this wall
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default function App() {
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const health = useQuery(trpc.health.queryOptions())
  const auth = useQuery(trpc.auth.session.queryOptions())
  async function handleAuth(action: () => Promise<void>) { setAuthPending(true); setAuthError(null); try { await action() } catch (error) { setAuthPending(false); setAuthError(error instanceof Error ? error.message : 'Authentication failed') } }
  if (auth.isPending) return <AuthMessage title="Checking your session…" />
  if (auth.isError) return <AuthMessage title="Unable to reach the login service" detail={auth.error.message} />
  if (!auth.data.user) return <LoginScreen configured={auth.data.configured} apiOnline={Boolean(health.data)} pending={authPending} error={authError} onSignIn={() => void handleAuth(signInWithGoogle)} />
  return <ClimbingApp user={auth.data.user} canReview={auth.data.canReview} authPending={authPending} onSignOut={() => void handleAuth(signOut)} />
}

function ClimbingApp({ user, canReview, authPending, onSignOut }: { user: AuthUser; canReview: boolean; authPending: boolean; onSignOut: () => void }) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View>('home')
  const [frame, setFrame] = useState<WallFrame | null>(null)
  const [detectedHolds, setDetectedHolds] = useState<DetectedHold[]>([])
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('local')
  const [editingWall, setEditingWall] = useState<WallRecord | null>(null)
  const [selectedWall, setSelectedWall] = useState<WallRecord | null>(null)
  const [editingClimb, setEditingClimb] = useState<ClimbRecord | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const health = useQuery(trpc.health.queryOptions())
  const wallQuery = useQuery(trpc.walls.list.queryOptions())
  const climbQuery = useQuery(trpc.climbs.list.queryOptions())
  const walls = (wallQuery.data ?? []) as WallRecord[]
  const climbs = (climbQuery.data ?? []) as ClimbRecord[]
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: trpc.walls.list.queryKey() }), queryClient.invalidateQueries({ queryKey: trpc.climbs.list.queryKey() })]) }
  const aiDetection = useMutation(trpc.wall.detectHolds.mutationOptions())
  const createWall = useMutation(trpc.walls.create.mutationOptions({ onSuccess: async (wall) => { await refresh(); setNotice(`${wall.name} saved. It is ready for climbs.`); setView('library') } }))
  const updateWall = useMutation(trpc.walls.update.mutationOptions({ onSuccess: async (wall) => { await refresh(); setNotice(`${wall.name} updated.`); setView('library') } }))
  const deleteWall = useMutation(trpc.walls.delete.mutationOptions({ onSuccess: refresh }))
  const createClimb = useMutation(trpc.climbs.create.mutationOptions({ onSuccess: async (climb) => { await refresh(); setNotice(climb.status === 'draft' ? 'Draft saved to the topo book.' : `${climb.name} published for review.`); setView('library') } }))
  const updateClimb = useMutation(trpc.climbs.update.mutationOptions({ onSuccess: async (climb) => { await refresh(); setNotice(climb.status === 'draft' ? 'Draft updated.' : `${climb.name} updated and published for review.`); setView('library') } }))
  const deleteClimb = useMutation(trpc.climbs.delete.mutationOptions({ onSuccess: refresh }))
  const reviewClimb = useMutation(trpc.climbs.review.mutationOptions({ onSuccess: async (climb) => { await refresh(); setNotice(climb.status === 'approved' ? `${climb.name} approved.` : `Changes requested for ${climb.name}.`) } }))

  function resetDraft() { setFrame(null); setDetectedHolds([]); setEditingWall(null); setSelectedWall(null); setEditingClimb(null); setError(''); createWall.reset(); updateWall.reset(); createClimb.reset(); updateClimb.reset(); reviewClimb.reset() }
  function go(next: View) { resetDraft(); setNotice(''); setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function processFrame(nextFrame: WallFrame) {
    setError(''); setIsAnalyzing(true)
    try {
      const localHolds = await detectHolds(nextFrame)
      let nextHolds = localHolds
      let mode: DetectionMode = 'local'
      if (health.data?.ai.enabled && nextFrame.sourceType !== 'demo') {
        try { const result = await aiDetection.mutateAsync({ imageDataUrl: nextFrame.dataUrl }); nextHolds = mergeAiHoldDetections(localHolds, result.holds); mode = 'ai' } catch { /* Local detection remains usable. */ }
      }
      setFrame(nextFrame); setDetectedHolds(nextHolds); setDetectionMode(mode); setView('wall-editor')
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'The wall could not be scanned.') }
    finally { setIsAnalyzing(false) }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
    if (file.size > 80 * 1024 * 1024) { setError('Choose a photo or video smaller than 80 MB.'); return }
    try { await processFrame(await readWallAsset(file)) } catch (nextError) { setError(nextError instanceof Error ? nextError.message : 'The file could not be opened.') }
  }

  function editWall(wall: WallRecord) { setEditingWall(wall); setFrame({ dataUrl: wall.imageDataUrl, width: wall.imageWidth, height: wall.imageHeight, sourceType: wall.sourceType }); setDetectedHolds(wall.holds.map((hold) => ({ ...hold, role: null }))); setDetectionMode('local'); setView('wall-editor'); window.scrollTo({ top: 0 }) }
  function startClimb(wall: WallRecord, climb?: ClimbRecord) { setSelectedWall(wall); setEditingClimb(climb ?? null); setView('climb-editor'); window.scrollTo({ top: 0 }) }
  function saveWall(name: string, holds: DetectedHold[]) {
    const mapped = holds.map(({ id, center, points, source }) => ({
      id,
      center: { x: Math.min(100, Math.max(0, center.x)), y: Math.min(100, Math.max(0, center.y)) },
      points: points.map((point) => ({ x: Math.min(100, Math.max(0, point.x)), y: Math.min(100, Math.max(0, point.y)) })),
      source,
    }))
    if (editingWall) {
      const keptIds = new Set(mapped.map((hold) => hold.id))
      const affectedClimbs = climbs.filter(
        (climb) => climb.wallId === editingWall.id && climb.assignments.some((assignment) => !keptIds.has(assignment.holdId)),
      )
      if (affectedClimbs.length > 0) {
        window.alert(`This edit removes a hold used by ${affectedClimbs.length} saved climb${affectedClimbs.length === 1 ? '' : 's'}. Update or delete those climbs first.`)
        return
      }
      updateWall.mutate({ id: editingWall.id, name, holds: mapped })
    } else if (frame) {
      createWall.mutate({ name, imageDataUrl: frame.dataUrl, imageWidth: frame.width, imageHeight: frame.height, sourceType: frame.sourceType, holds: mapped })
    }
  }

  const activeNav = view === 'library' ? 'library' : 'create'
  return <main className="app-shell"><header className="site-header"><Brand /><nav aria-label="Primary navigation"><button className={`nav-item${activeNav === 'create' ? ' active' : ''}`} type="button" onClick={() => go('home')}>Create</button><button className={`nav-item${activeNav === 'library' ? ' active' : ''}`} type="button" onClick={() => go('library')}>Topo book</button></nav><div className="header-account"><div className="header-meta"><span className={`api-light${health.data ? ' online' : ''}`} /><span>{health.data?.ai.enabled ? 'AI scan ready' : 'Local scan'}</span></div><div className="user-menu">{user.image && <img src={user.image} alt="" referrerPolicy="no-referrer" />}<span>{user.name ?? user.email ?? 'Climber'}</span><button type="button" disabled={authPending} onClick={onSignOut}>Sign out</button></div></div></header>
    <input ref={cameraInput} className="visually-hidden" type="file" accept="image/*" capture="environment" onChange={handleFile} /><input ref={videoInput} className="visually-hidden" type="file" accept="video/*" capture="environment" onChange={handleFile} /><input ref={uploadInput} className="visually-hidden" type="file" accept="image/*,video/*" onChange={handleFile} />
    {view === 'home' && <CreateHome wallCount={walls.length} onAddWall={() => setView('source')} onSetClimb={() => setView('wall-picker')} />}
    {view === 'source' && <WallSource onCamera={() => cameraInput.current?.click()} onRecord={() => videoInput.current?.click()} onUpload={() => uploadInput.current?.click()} onDemo={() => void processFrame(createDemoWall())} onCancel={() => go('home')} />}
    {view === 'wall-editor' && frame && <WallForm key={editingWall?.id ?? frame.dataUrl.slice(-24)} frame={frame} initialHolds={detectedHolds} initialName={editingWall?.name ?? ''} detectionMode={detectionMode} editing={Boolean(editingWall)} pending={createWall.isPending || updateWall.isPending} error={createWall.error?.message ?? updateWall.error?.message} onCancel={() => go(editingWall ? 'library' : 'source')} onSave={saveWall} />}
    {view === 'wall-picker' && <WallPicker walls={walls} onChoose={(wall) => startClimb(wall)} onAdd={() => setView('source')} onCancel={() => go('home')} />}
    {view === 'climb-editor' && selectedWall && <ClimbForm key={editingClimb?.id ?? selectedWall.id} wall={selectedWall} climb={editingClimb ?? undefined} pending={createClimb.isPending || updateClimb.isPending} error={createClimb.error?.message ?? updateClimb.error?.message} onCancel={() => go('library')} onSave={(details) => { if (editingClimb) updateClimb.mutate({ id: editingClimb.id, ...details }); else createClimb.mutate({ wallId: selectedWall.id, ...details }) }} />}
    {view === 'library' && <TopoBook walls={walls} climbs={climbs} notice={notice} canReview={canReview} reviewTargetId={reviewClimb.variables?.id} reviewPending={reviewClimb.isPending} reviewError={reviewClimb.error?.message} onAddWall={() => go('source')} onSetClimb={(wall) => startClimb(wall)} onEditWall={editWall} onDeleteWall={(wall) => { const count = climbs.filter((climb) => climb.isOwner && climb.wallId === wall.id).length; if (window.confirm(`Delete ${wall.name}? This will also delete ${count} climb${count === 1 ? '' : 's'} on it.`)) deleteWall.mutate({ id: wall.id }) }} onEditClimb={(climb) => { const wall = walls.find((item) => item.id === climb.wallId); if (wall) startClimb(wall, climb) }} onDeleteClimb={(climb) => { if (window.confirm(`Delete ${climb.name || 'this draft'}?`)) deleteClimb.mutate({ id: climb.id }) }} onReview={(climb, decision, grade, comment) => reviewClimb.mutate({ id: climb.id, decision, grade, comment })} />}
    {(isAnalyzing || error) && <div className="overlay" role={error ? 'alertdialog' : 'dialog'} aria-modal="true"><div className="analysis-card">{error ? <><button className="close-button" type="button" onClick={() => setError('')} aria-label="Close"><Icon name="close" /></button><span className="analysis-icon error-icon"><Icon name="image" size={30} /></span><h2>We couldn’t scan that</h2><p>{error}</p><button className="primary-action" type="button" onClick={() => setError('')}>Try another file</button></> : <><span className="analysis-icon"><Icon name="scan" size={30} /></span><h2>Mapping your wall</h2><p>Finding individual holds and tracing their edges…</p><span className="progress-track"><span /></span></>}</div></div>}
    <footer><Brand /><p>Save the wall. Set the climb.</p></footer></main>
}
