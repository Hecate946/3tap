# 3tap

**three states. one tap.**

A tiny, accountless three-state habit grid for **3tap.cc**.

## Normal workflow

```bash
npm run dev
```

That is the entire local workflow. 3tap automatically starts a private local Supabase/Postgres instance, applies any pending migrations, injects its local API credentials into SvelteKit, and starts Vite.

Local data never touches production. It persists in Docker between restarts.

Prerequisite: **Docker must be installed and running.** Supabase's local development stack runs in containers.

Useful but rarely needed:

```bash
npm run db:reset   # wipe/rebuild LOCAL data only
npm run db:stop    # stop the local Supabase containers
```

## Production workflow

Push `main` to GitHub. Vercel builds/deploys automatically.

On a production build, `scripts/build.mjs`:

1. refuses to deploy if production DB credentials are missing;
2. applies pending files from `supabase/migrations/` to the production database;
3. builds the SvelteKit app only after the DB is ready.

This prevents a deployment from silently shipping a navbar-only app because the database was missing or behind the code.

### One-time Vercel setup

In **Vercel → 3tap → Settings → Environment Variables**, add these as **Production** variables:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_DB_URL
```

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: your `sb_secret_...` server key. Never expose this to browser code.
- `SUPABASE_DB_URL`: Supabase Postgres connection string from **Connect**. If the direct connection is unavailable from the build environment, use the Session Pooler connection string.

After saving them, redeploy once. From then on: **edit locally → git push → production works**.

## Database environments

| Environment | Database | Configuration |
| --- | --- | --- |
| `npm run dev` | Local Supabase/Postgres in Docker | automatic |
| Vercel Preview | no production migration | Vercel Preview env if you choose to use previews |
| Vercel Production / 3tap.cc | Hosted Supabase production project | Vercel Production secrets |

Schema changes live only in `supabase/migrations/`. Do not edit production tables manually. Add a migration, test it locally with `npm run dev`, then push it.

## Architecture

- SvelteKit 2 + Svelte 5
- Supabase Postgres
- local-first UI / optimistic taps
- accountless board secret authentication
- Vercel production hosting
- local Supabase CLI stack for development
