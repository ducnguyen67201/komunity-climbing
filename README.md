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
