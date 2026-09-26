import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { signInWithGoogle, signOut } from './auth'
import { queryClient, trpc } from './trpc'

type AuthUser = {
  name?: string | null
  email?: string | null
  image?: string | null
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
    } catch (error) {
      setAuthPending(false)
      setAuthError(
        error instanceof Error ? error.message : 'Authentication failed',
      )
    }
  }

  if (auth.isPending) {
    return (
      <main className="shell auth-shell">
        <div>
          <p className="eyebrow">Komunity climbing</p>
          <h1>Checking your session…</h1>
        </div>
      </main>
    )
  }

  if (auth.isError) {
    return (
      <main className="shell auth-shell">
        <div>
          <p className="eyebrow">Komunity climbing</p>
          <h1>Unable to reach the login service</h1>
          <p className="error">{auth.error.message}</p>
        </div>
      </main>
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
      apiOnline={Boolean(health.data)}
      authPending={authPending}
      onSignOut={() => void handleAuth(signOut)}
    />
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
    <main className="shell auth-shell">
      <section className="login-card">
        <div className="login-mark" aria-hidden="true">
          K
        </div>
        <p className="eyebrow">Komunity climbing</p>
        <h1>Climb together.</h1>
        <p className="lede">
          Sign in to access the community logbook and record your climbs.
        </p>

        <button
          className="google-button login-button"
          type="button"
          disabled={pending || !configured}
          onClick={onSignIn}
        >
          <span aria-hidden="true">G</span>
          {pending ? 'Opening Google…' : 'Continue with Google'}
        </button>

        {!configured && (
          <aside className="setup-notice" role="status">
            Add <code>AUTH_GOOGLE_ID</code> and{' '}
            <code>AUTH_GOOGLE_SECRET</code> to the selected Doppler config.
          </aside>
        )}

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="login-status" aria-live="polite">
          <span className={apiOnline ? 'status-dot online' : 'status-dot'} />
          {apiOnline ? 'API connected' : 'API offline'}
        </div>
      </section>
    </main>
  )
}

function ClimbingApp({
  user,
  apiOnline,
  authPending,
  onSignOut,
}: {
  user: AuthUser
  apiOnline: boolean
  authPending: boolean
  onSignOut: () => void
}) {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V3')
  const climbs = useQuery(trpc.climbs.list.queryOptions())
  const createClimb = useMutation(
    trpc.climbs.create.mutationOptions({
      onSuccess: async () => {
        setName('')
        await queryClient.invalidateQueries({
          queryKey: trpc.climbs.list.queryKey(),
        })
      },
    }),
  )

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createClimb.mutate({ name, grade })
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Vite · React · tRPC</p>
          <h1>Cak Climbing</h1>
          <p className="lede">The shared Komunity climbing logbook.</p>
        </div>
        <div className="header-actions">
          <div className="api-status" aria-live="polite">
            <span className={apiOnline ? 'status-dot online' : 'status-dot'} />
            {apiOnline ? 'API connected' : 'API offline'}
          </div>
          <div className="user-menu">
            {user.image && (
              <img src={user.image} alt="" referrerPolicy="no-referrer" />
            )}
            <div>
              <strong>{user.name ?? 'Climber'}</strong>
              <span>{user.email}</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              disabled={authPending}
              onClick={onSignOut}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Community logbook</p>
            <h2>Log a climb</h2>
          </div>
          <span className="count">{climbs.data?.length ?? 0} logged</span>
        </div>

        <form className="climb-form" onSubmit={handleSubmit}>
          <label>
            Climb name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Moonboard project"
              maxLength={80}
              required
            />
          </label>
          <label>
            Grade
            <input
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
              placeholder="V3"
              maxLength={12}
              required
            />
          </label>
          <button type="submit" disabled={createClimb.isPending}>
            {createClimb.isPending ? 'Saving…' : 'Add climb'}
          </button>
        </form>

        {createClimb.error && (
          <p className="error" role="alert">
            {createClimb.error.message}
          </p>
        )}

        <div className="climb-list" aria-busy={climbs.isPending}>
          {climbs.isPending && <p className="empty">Loading climbs…</p>}
          {climbs.isError && (
            <p className="error" role="alert">
              Could not load climbs: {climbs.error.message}
            </p>
          )}
          {climbs.data?.map((climb) => (
            <article className="climb-card" key={climb.id}>
              <div>
                <h3>{climb.name}</h3>
                <time dateTime={climb.createdAt}>
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(climb.createdAt))}
                </time>
              </div>
              <strong>{climb.grade}</strong>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
