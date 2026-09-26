import { useState, type FormEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { queryClient, trpc } from './trpc'

export default function App() {
  const [name, setName] = useState('')
  const [grade, setGrade] = useState('V3')

  const health = useQuery(trpc.health.queryOptions())
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
          <p className="lede">
            A lean, typed starting point. Replace this demo with your frontend.
          </p>
        </div>
        <div className="api-status" aria-live="polite">
          <span className={health.data ? 'status-dot online' : 'status-dot'} />
          {health.isPending
            ? 'Checking API'
            : health.isError
              ? 'API offline'
              : 'API connected'}
        </div>
      </header>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Typed mutation</p>
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
