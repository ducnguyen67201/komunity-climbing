# Cak Climbing

A lightweight, all-TypeScript starter with:

- Vite + React for the frontend
- tRPC's standalone Node adapter for the backend
- TanStack Query using tRPC's recommended integration
- Zod validation at the API boundary

## Run it

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/trpc` requests to the API on port
`3001`, so local development does not need CORS configuration.

## Useful commands

```bash
npm run dev       # frontend and API with hot reload
npm run check     # TypeScript check
npm run build     # check types and build the frontend
npm run start:api # run the API without watch mode
```

## Where to work

- `src/App.tsx` — current UI
- `src/trpc.ts` — typed client and query cache
- `server/router.ts` — tRPC procedures and input validation
- `server/index.ts` — tiny Node HTTP entry point

The demo data is intentionally in memory and resets whenever the API restarts.
Add a database only when the frontend shape and persistence needs are clear.

## Railway deployment

The GitHub Actions workflow in `.github/workflows/ci-deploy.yml` checks every
pull request to `main`. A push or merge to `main` runs the same checks, deploys
the backend, waits for it to succeed, and then deploys the frontend.

Create two services in one Railway project and configure them as follows:

| Setting | `backend` service | `frontend` service |
| --- | --- | --- |
| Dockerfile path | `Dockerfile.backend` | `Dockerfile.frontend` |
| Healthcheck path | `/health` | `/health` |
| Pre-deploy command | `npm run migrate --if-present` | none |
| Service variable | `CORS_ORIGIN=https://<frontend-domain>` | `VITE_API_URL=https://<backend-domain>` |

Use the final public domains, including `https://` and without a trailing slash.
The migration command is intentionally optional while this starter has no
database. Once a database is added, define a `migrate` package script; a failed
migration will then stop Railway before the new backend release goes live.

In the GitHub repository, create a `production` environment and add:

- Secret `RAILWAY_TOKEN`: a Railway project token scoped to production.
- Secret `RAILWAY_PROJECT_ID`: the Railway project ID.
- Variable `RAILWAY_ENVIRONMENT`: Railway environment name (defaults to
  `production`).
- Variable `RAILWAY_BACKEND_SERVICE`: backend service name or ID (defaults to
  `backend`).
- Variable `RAILWAY_FRONTEND_SERVICE`: frontend service name or ID (defaults to
  `frontend`).

Disable Railway GitHub autodeploys for these services so a merge does not create
duplicate deployments; GitHub Actions is the deployment trigger.
