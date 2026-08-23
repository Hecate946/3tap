# 3tap Cloudflare Worker production setup

3tap production is a **Cloudflare Worker**, not Vercel and not Cloudflare Pages.

## One-time local repair

After applying this patch:

```bash
bash scripts/apply-cloudflare-fix.sh
```

This deletes the stale lockfile and regenerates it from the corrected Cloudflare dependencies. The script deletes itself afterward.

## Normal workflow afterward

Local:

```bash
npm run dev
```

This starts the local Supabase stack and the SvelteKit dev server.

Production:

```bash
git push
```

Cloudflare Workers Builds should use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

## One-time Cloudflare runtime secrets

In the deployed Worker, add under **Settings -> Variables & Secrets**:

- `SUPABASE_URL` — variable
- `SUPABASE_SERVICE_ROLE_KEY` — secret

These are runtime Worker bindings. Build variables alone are not enough for `/api/*` to access Supabase.

## Optional automatic production migrations

Under the Cloudflare **Build** variables/secrets, add:

- `SUPABASE_DB_URL` — secret

Then `npm run build` automatically applies pending Supabase migrations before building.
