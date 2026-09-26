# Cak Climbing

A lightweight, all-TypeScript starter with:

- Vite + React for the frontend
- Express + tRPC for the backend
- TanStack Query using tRPC's recommended integration
- Zod validation at the API boundary
- Google OAuth with Auth.js

## Run it

```bash
npm install
doppler setup --project komunity-climbing --config dev
npm run dev
```

`npm run dev` injects secrets with `doppler run`. Add the Google OAuth values
to Doppler using interactive input so they do not end up in shell history:

```bash
doppler secrets set AUTH_GOOGLE_ID
doppler secrets set AUTH_GOOGLE_SECRET
```

In Google Cloud, set the authorized redirect URI to:

```text
http://localhost:5173/auth/callback/google
```

The app exposes only the login screen until a valid Google session exists.
Climb queries and mutations are also protected on the server, not only hidden
in the frontend.

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
- `server/auth.ts` — Auth.js Google configuration
- `server/index.ts` — Express entry point

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
| Auth variables | `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | none |

Use the final public domains, including `https://` and without a trailing slash.
Also add `https://<backend-domain>/auth/callback/google` as an authorized
redirect URI on the Google OAuth client. Keep production auth values in Railway
service variables or a Doppler integration; never commit them to the repository.
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
