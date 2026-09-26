import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { signInWithGoogle, signOut } from './auth'
import { queryClient, trpc } from './trpc'
import {
  createDemoWall,
  createManualHold,
  detectHolds,
  mergeAiHoldDetections,
  readWallAsset,
  type DetectedHold,
  type HoldRole,
  type WallFrame,
} from './wallDetection'

const roleOptions: Array<{
  id: HoldRole
  label: string
  shortLabel: string
  hint: string
}> = [
  { id: 'start', label: 'Start hold', shortLabel: 'Start', hint: 'First hold' },
  { id: 'hand', label: 'Hand hold', shortLabel: 'Hand', hint: 'Hands only' },
  { id: 'foot', label: 'Foot hold', shortLabel: 'Foot', hint: 'Feet only' },
  { id: 'finish', label: 'Finish hold', shortLabel: 'Finish', hint: 'Top hold' },
]

const grades = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10+']
type DetectionMode = 'ai' | 'local'
type AuthUser = {
  name?: string | null
  email?: string | null
  image?: string | null
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    camera: (
      <>
        <path d="M14.5 4 16 6h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2h5Z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4M7 9l5-5 5 5" />
        <path d="M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
        <path d="M8 12h8" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 .8 2.2A5 5 0 0 0 16 8.3l2 .7-2 .7a5 5 0 0 0-3.2 3.1L12 15l-.8-2.2A5 5 0 0 0 8 9.7L6 9l2-.7a5 5 0 0 0 3.2-3.1L12 3Z" />
        <path d="m5 14 .5 1.4A3.2 3.2 0 0 0 7.6 17l1.4.5-1.4.5a3.2 3.2 0 0 0-2.1 1.6L5 21l-.5-1.4A3.2 3.2 0 0 0 2.4 18L1 17.5l1.4-.5a3.2 3.2 0 0 0 2.1-1.6L5 14Z" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    undo: <path d="m9 7-5 5 5 5M4 12h10a6 6 0 0 1 6 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m21 15-5-5L5 20" />
      </>
    ),
    play: <path d="m9 7 8 5-8 5V7Z" />,
    video: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function Brand() {
  return (
    <div className="brand" aria-label="Crux climbing">
      <span className="brand-mark">
        <span />
        <span />
        <span />
      </span>
      <span>CRUX</span>
    </div>
  )
}

function ScanLanding({
  onCamera,
  onRecord,
  onUpload,
  onDemo,
  recentClimbs,
}: {
  onCamera: () => void
  onRecord: () => void
  onUpload: () => void
  onDemo: () => void
  recentClimbs: Array<{ id: string; name: string; grade: string; holds: unknown[] }>
}) {
  return (
    <>
      <section className="landing-grid">
        <div className="landing-copy">
          <p className="eyebrow">Route setting, simplified</p>
          <h1>Turn any wall into your next climb.</h1>
          <p className="lede">
            Scan a climbing wall, let Crux map the holds, then tap out a route in
            seconds.
          </p>
          <div className="hero-actions source-actions">
            <button className="primary-action source-action" type="button" onClick={onCamera}>
              <span className="source-icon"><Icon name="camera" /></span>
              <span><strong>Take a photo</strong><small>Open your camera</small></span>
            </button>
            <button className="secondary-action source-action" type="button" onClick={onRecord}>
              <span className="source-icon"><Icon name="video" /></span>
              <span><strong>Record wall</strong><small>Capture a short video</small></span>
            </button>
            <button className="secondary-action source-action" type="button" onClick={onUpload}>
              <span className="source-icon"><Icon name="upload" /></span>
              <span><strong>Upload file</strong><small>Choose a photo or video</small></span>
            </button>
          </div>
          <button className="demo-link" type="button" onClick={onDemo}>
            <Icon name="play" size={16} />
            No wall handy? Try a sample scan
          </button>
        </div>

        <div className="scanner-preview" aria-hidden="true">
          <div className="preview-glow" />
          <div className="phone-frame">
            <div className="phone-top">
              <span>Scan wall</span>
              <span className="phone-pill">LIVE</span>
            </div>
            <div className="preview-wall">
              {Array.from({ length: 34 }, (_, index) => (
                <span
                  className={`preview-hold hold-${(index % 5) + 1}`}
                  key={index}
                  style={{
                    left: `${8 + ((index * 29) % 84)}%`,
                    top: `${8 + ((index * 19) % 80)}%`,
                    rotate: `${(index * 37) % 180}deg`,
                    scale: `${0.72 + (index % 4) * 0.12}`,
                  }}
                />
              ))}
              <span className="scan-line" />
              <span className="scan-corner corner-one" />
              <span className="scan-corner corner-two" />
              <span className="scan-corner corner-three" />
              <span className="scan-corner corner-four" />
            </div>
            <div className="phone-bottom">
              <span className="capture-ring"><span /></span>
              <p>Move slowly across the whole wall</p>
            </div>
          </div>
          <div className="detection-badge">
            <Icon name="sparkles" size={18} />
            <span><strong>Holds detected</strong>Ready to create</span>
          </div>
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">From wall to route</p>
            <h2 id="how-heading">Three moves. One new climb.</h2>
          </div>
          {recentClimbs.length > 0 && (
            <span className="saved-count">{recentClimbs.length} route{recentClimbs.length === 1 ? '' : 's'} saved</span>
          )}
        </div>
        <div className="steps-grid">
          <article>
            <span className="step-number">01</span>
            <span className="step-icon"><Icon name="camera" /></span>
            <h3>Scan the wall</h3>
            <p>Take one clear photo or use a frame from a short wall video.</p>
          </article>
          <article>
            <span className="step-number">02</span>
            <span className="step-icon"><Icon name="sparkles" /></span>
            <h3>Map every hold</h3>
            <p>On-device vision finds each hold and turns it into a tappable shape.</p>
          </article>
          <article>
            <span className="step-number">03</span>
            <span className="step-icon"><Icon name="target" /></span>
            <h3>Set your climb</h3>
            <p>Mark starts, hands, feet, and the finish. Then save your route.</p>
          </article>
        </div>
      </section>
    </>
  )
}

function RouteEditor({
  frame,
  holds,
  setHolds,
  onNewScan,
  onSave,
  isSaving,
  saveError,
  detectionMode,
}: {
  frame: WallFrame
  holds: DetectedHold[]
  setHolds: (holds: DetectedHold[]) => void
  onNewScan: () => void
  onSave: (details: { name: string; grade: string; wallName: string }) => void
  isSaving: boolean
  saveError?: string
  detectionMode: DetectionMode
}) {
  const [activeRole, setActiveRole] = useState<HoldRole>('hand')
  const [addMode, setAddMode] = useState(false)
  const [history, setHistory] = useState<DetectedHold[][]>([])
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V3')
  const [wallName, setWallName] = useState('Main wall')
  const selectedHolds = holds.filter((hold) => hold.role)
  const counts = useMemo(
    () =>
      roleOptions.reduce<Record<HoldRole, number>>(
        (result, option) => ({
          ...result,
          [option.id]: holds.filter((hold) => hold.role === option.id).length,
        }),
        { hand: 0, foot: 0, start: 0, finish: 0 },
      ),
    [holds],
  )

  function commit(nextHolds: DetectedHold[]) {
    setHistory((current) => [...current.slice(-19), holds])
    setHolds(nextHolds)
  }

  function markHold(id: string) {
    commit(
      holds.map((hold) =>
        hold.id === id
          ? { ...hold, role: hold.role === activeRole ? null : activeRole }
          : hold,
      ),
    )
  }

  function handleHoldKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      markHold(id)
    }
  }

  function addManualHold(event: PointerEvent<HTMLDivElement>) {
    if (!addMode || (event.target as Element).closest('[data-hold]')) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const center = {
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    }
    const manualHold = createManualHold(center, frame.width / frame.height)
    manualHold.role = activeRole
    commit([...holds, manualHold])
  }

  function undo() {
    const previous = history.at(-1)
    if (!previous) return
    setHolds(previous)
    setHistory((current) => current.slice(0, -1))
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({ name, grade, wallName })
  }

  return (
    <section className="editor-shell">
      <div className="editor-topbar">
        <div>
          <p className="eyebrow">New route</p>
          <h1>Build your climb</h1>
        </div>
        <div className="scan-status">
          <span className="status-dot" />
          {holds.length} holds mapped · {detectionMode === 'ai' ? 'AI assisted' : 'local scan'}
        </div>
      </div>

      <div className="workflow-steps" aria-label="Creation progress">
        <span className="complete"><b><Icon name="check" size={14} /></b> Scan wall</span>
        <i />
        <span className="active"><b>2</b> Mark holds</span>
        <i />
        <span><b>3</b> Save climb</span>
      </div>

      <div className="editor-grid">
        <div className="wall-workspace">
          <div className="workspace-toolbar">
            <div className="tool-group" role="group" aria-label="Hold type">
              {roleOptions.map((option) => (
                <button
                  className={`role-tool role-${option.id}${activeRole === option.id ? ' selected' : ''}`}
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setActiveRole(option.id)
                    setAddMode(false)
                  }}
                  aria-pressed={activeRole === option.id && !addMode}
                >
                  <span className="role-swatch" />
                  {option.shortLabel}
                </button>
              ))}
            </div>
            <div className="utility-tools">
              <button
                className={addMode ? 'active' : ''}
                type="button"
                onClick={() => setAddMode((current) => !current)}
                aria-pressed={addMode}
              >
                <Icon name="plus" size={17} />
                Add missed hold
              </button>
              <button type="button" onClick={undo} disabled={!history.length}>
                <Icon name="undo" size={17} />
                Undo
              </button>
            </div>
          </div>

          <div className="wall-canvas-wrap">
            <div
              className={`wall-canvas${addMode ? ' adding' : ''}`}
              style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
              onPointerDown={addManualHold}
            >
              <img src={frame.dataUrl} alt="Scanned climbing wall" />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Detected climbing holds">
                {holds.map((hold, index) => {
                  const points = hold.points.map(({ x, y }) => `${x},${y}`).join(' ')
                  const roleClass = hold.role ? ` selected-hold role-${hold.role}` : 'candidate-hold'
                  return (
                    <g
                      key={hold.id}
                      className={roleClass}
                      data-hold="true"
                      role="button"
                      tabIndex={0}
                      aria-label={`${hold.role ? `${hold.role} hold` : 'Detected hold'} ${index + 1}`}
                      aria-pressed={Boolean(hold.role)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => markHold(hold.id)}
                      onKeyDown={(event) => handleHoldKeyDown(event, hold.id)}
                    >
                      {hold.role && <polygon className="hold-halo" points={points} />}
                      <polygon className="hold-shape" points={points} />
                      {hold.role && (
                        <circle className="hold-marker" cx={hold.center.x} cy={hold.center.y} r="1.25" />
                      )}
                    </g>
                  )
                })}
              </svg>
              {addMode && (
                <div className="add-instruction"><Icon name="plus" size={16} /> Tap the center of a missed hold</div>
              )}
            </div>
          </div>

          <div className="canvas-caption">
            <p><Icon name="sparkles" size={16} /> Tap an outlined hold to mark it as <strong>{activeRole}</strong>.</p>
            <button type="button" onClick={onNewScan}>Replace scan</button>
          </div>
        </div>

        <aside className="route-panel">
          <div className="panel-intro">
            <p className="eyebrow">Route details</p>
            <h2>Name your climb</h2>
            <p>Choose a hold type, then tap every hold that belongs in the route.</p>
          </div>

          <div className="route-summary">
            <div><strong>{selectedHolds.length}</strong><span>holds selected</span></div>
            <div><strong>{counts.foot}</strong><span>feet</span></div>
            <div><strong>{counts.hand + counts.start + counts.finish}</strong><span>hands</span></div>
          </div>

          <div className="role-legend">
            {roleOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`legend-row role-${option.id}${activeRole === option.id ? ' active' : ''}`}
                onClick={() => {
                  setActiveRole(option.id)
                  setAddMode(false)
                }}
              >
                <span className="role-swatch" />
                <span><strong>{option.label}</strong><small>{option.hint}</small></span>
                <b>{counts[option.id]}</b>
              </button>
            ))}
          </div>

          <form className="route-form" onSubmit={submit}>
            <label>
              Climb name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Copperhead"
                maxLength={80}
                required
              />
            </label>
            <div className="form-row">
              <label>
                Grade
                <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                  {grades.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                Wall
                <input
                  value={wallName}
                  onChange={(event) => setWallName(event.target.value)}
                  maxLength={80}
                  required
                />
              </label>
            </div>
            {saveError && <p className="error" role="alert">{saveError}</p>}
            <button
              className="save-button"
              type="submit"
              disabled={isSaving || selectedHolds.length < 2}
            >
              {isSaving ? 'Saving climb…' : 'Create climb'}
              {!isSaving && <Icon name="arrow" size={18} />}
            </button>
            {selectedHolds.length < 2 && <small className="form-hint">Select at least two holds to continue.</small>}
          </form>
        </aside>
      </div>
    </section>
  )
}

export default function App() {
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const health = useQuery(trpc.health.queryOptions())
  const auth = useQuery(trpc.auth.session.queryOptions())

  async function handleAuth(action: () => Promise<void>) {
    setAuthPending(true)
    setAuthError(null)

    try {
      await action()
    } catch (nextError) {
      setAuthPending(false)
      setAuthError(
        nextError instanceof Error ? nextError.message : 'Authentication failed',
      )
    }
  }

  if (auth.isPending) {
    return <AuthMessage title="Checking your session…" />
  }

  if (auth.isError) {
    return (
      <AuthMessage
        title="Unable to reach the login service"
        detail={auth.error.message}
      />
    )
  }

  if (!auth.data.user) {
    return (
      <LoginScreen
        configured={auth.data.configured}
        apiOnline={Boolean(health.data)}
        pending={authPending}
        error={authError}
        onSignIn={() => void handleAuth(signInWithGoogle)}
      />
    )
  }

  return (
    <ClimbingApp
      user={auth.data.user}
      authPending={authPending}
      onSignOut={() => void handleAuth(signOut)}
    />
  )
}

function AuthMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="auth-shell">
      <section className="login-card">
        <Brand />
        <p className="eyebrow">Komunity climbing</p>
        <h1>{title}</h1>
        {detail && <p className="error">{detail}</p>}
      </section>
    </main>
  )
}

function LoginScreen({
  configured,
  apiOnline,
  pending,
  error,
  onSignIn,
}: {
  configured: boolean
  apiOnline: boolean
  pending: boolean
  error: string | null
  onSignIn: () => void
}) {
  return (
    <main className="auth-shell">
      <section className="login-card">
        <Brand />
        <p className="eyebrow">Komunity climbing</p>
        <h1>Set routes together.</h1>
        <p className="lede">
          Sign in to scan climbing walls, mark holds, and share new routes.
        </p>
        <button
          className="google-button"
          type="button"
          disabled={pending || !configured}
          onClick={onSignIn}
        >
          <span aria-hidden="true">G</span>
          {pending ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {!configured && (
          <aside className="setup-notice" role="status">
            Google authentication is not configured for this environment.
          </aside>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="login-status" aria-live="polite">
          <span className={`api-light${apiOnline ? ' online' : ''}`} />
          {apiOnline ? 'API connected' : 'API offline'}
        </div>
      </section>
    </main>
  )
}

function ClimbingApp({
  user,
  authPending,
  onSignOut,
}: {
  user: AuthUser
  authPending: boolean
  onSignOut: () => void
}) {
  const cameraInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const [frame, setFrame] = useState<WallFrame | null>(null)
  const [holds, setHolds] = useState<DetectedHold[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [detectionMode, setDetectionMode] = useState<DetectionMode>('local')
  const [savedClimb, setSavedClimb] = useState<{ name: string; grade: string; holdCount: number } | null>(null)

  const health = useQuery(trpc.health.queryOptions())
  const climbs = useQuery(trpc.climbs.list.queryOptions())
  const aiDetection = useMutation(trpc.wall.detectHolds.mutationOptions())
  const createClimb = useMutation(
    trpc.climbs.create.mutationOptions({
      onSuccess: async (climb) => {
        setSavedClimb({ name: climb.name, grade: climb.grade, holdCount: climb.holds.length })
        await queryClient.invalidateQueries({ queryKey: trpc.climbs.list.queryKey() })
      },
    }),
  )

  async function processFrame(nextFrame: WallFrame) {
    setFrame(null)
    setHolds([])
    setError('')
    setIsAnalyzing(true)
    try {
      const localHolds = await detectHolds(nextFrame)
      let nextHolds = localHolds
      let nextMode: DetectionMode = 'local'

      if (health.data?.ai.enabled && nextFrame.sourceType !== 'demo') {
        try {
          const aiResult = await aiDetection.mutateAsync({
            imageDataUrl: nextFrame.dataUrl,
          })
          nextHolds = mergeAiHoldDetections(localHolds, aiResult.holds)
          nextMode = 'ai'
        } catch {
          // A failed or unavailable AI scan must never block route creation.
        }
      }

      setFrame(nextFrame)
      setHolds(nextHolds)
      setDetectionMode(nextMode)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The wall could not be scanned.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 80 * 1024 * 1024) {
      setError('Choose a photo or video smaller than 80 MB.')
      return
    }
    setIsAnalyzing(true)
    setError('')
    setDetectionMode('local')
    aiDetection.reset()
    try {
      const nextFrame = await readWallAsset(file)
      await processFrame(nextFrame)
    } catch (nextError) {
      setFrame(null)
      setIsAnalyzing(false)
      setError(nextError instanceof Error ? nextError.message : 'The file could not be opened.')
    }
  }

  async function handleDemo() {
    await processFrame(createDemoWall())
  }

  function resetScan() {
    setFrame(null)
    setHolds([])
    setSavedClimb(null)
    setError('')
    createClimb.reset()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function saveClimb(details: { name: string; grade: string; wallName: string }) {
    if (!frame) return
    const selected = holds.filter(
      (hold): hold is DetectedHold & { role: HoldRole } => Boolean(hold.role),
    )
    createClimb.mutate({
      ...details,
      sourceType: frame.sourceType,
      imageWidth: frame.width,
      imageHeight: frame.height,
      holds: selected.map(({ id, role, center, points }) => ({ id, role, center, points })),
    })
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <Brand />
        <nav aria-label="Primary navigation">
          <button className="nav-item active" type="button" onClick={resetScan}>Create</button>
          <span className="nav-item">My climbs</span>
        </nav>
        <div className="header-account">
          <div className="header-meta">
            <span className={`api-light${health.data ? ' online' : ''}`} />
            <span>
              {health.isError
                ? 'Offline'
                : health.data?.ai.enabled
                  ? 'AI scan ready'
                  : 'Local scan'}
            </span>
          </div>
          <div className="user-menu">
            {user.image && <img src={user.image} alt="" referrerPolicy="no-referrer" />}
            <span>{user.name ?? user.email ?? 'Climber'}</span>
            <button type="button" disabled={authPending} onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
      />
      <input
        ref={videoInput}
        className="visually-hidden"
        type="file"
        accept="video/*"
        capture="environment"
        onChange={handleFile}
      />
      <input
        ref={uploadInput}
        className="visually-hidden"
        type="file"
        accept="image/*,video/*"
        onChange={handleFile}
      />

      {frame ? (
        <RouteEditor
          frame={frame}
          holds={holds}
          setHolds={setHolds}
          onNewScan={resetScan}
          onSave={saveClimb}
          isSaving={createClimb.isPending}
          saveError={createClimb.error?.message}
          detectionMode={detectionMode}
        />
      ) : (
        <ScanLanding
          onCamera={() => cameraInput.current?.click()}
          onRecord={() => videoInput.current?.click()}
          onUpload={() => uploadInput.current?.click()}
          onDemo={handleDemo}
          recentClimbs={climbs.data ?? []}
        />
      )}

      {(isAnalyzing || error) && (
        <div className="overlay" role={error ? 'alertdialog' : 'dialog'} aria-modal="true">
          <div className="analysis-card">
            {error ? (
              <>
                <button className="close-button" type="button" onClick={() => setError('')} aria-label="Close">
                  <Icon name="close" />
                </button>
                <span className="analysis-icon error-icon"><Icon name="image" size={30} /></span>
                <h2>We couldn’t scan that</h2>
                <p>{error}</p>
                <button className="primary-action" type="button" onClick={() => setError('')}>Try another file</button>
              </>
            ) : (
              <>
                <span className="analysis-icon"><Icon name="scan" size={30} /></span>
                <h2>{health.data?.ai.enabled ? 'AI is mapping your wall' : 'Mapping your wall'}</h2>
                <p>
                  {health.data?.ai.enabled
                    ? 'Finding individual holds, then tracing their edges…'
                    : 'Finding hold edges and turning them into tappable shapes…'}
                </p>
                <span className="progress-track"><span /></span>
              </>
            )}
          </div>
        </div>
      )}

      {savedClimb && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="saved-title">
          <div className="success-card">
            <span className="success-mark"><Icon name="check" size={30} /></span>
            <p className="eyebrow">Climb created</p>
            <h2 id="saved-title">{savedClimb.name}</h2>
            <p><strong>{savedClimb.grade}</strong> · {savedClimb.holdCount} marked holds</p>
            <div className="success-actions">
              <button className="primary-action" type="button" onClick={() => setSavedClimb(null)}>Keep editing</button>
              <button className="secondary-action" type="button" onClick={resetScan}>Scan another wall</button>
            </div>
          </div>
        </div>
      )}

      <footer>
        <Brand />
        <p>Set routes. Share beta. Climb more.</p>
      </footer>
    </main>
  )
}
