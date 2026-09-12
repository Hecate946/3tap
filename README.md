# 3tap

Tiny habit tracker I made for myself to stay accountable. Tap each habit between `-`, `|`, and `+`; look back at history when you want to.

## dev

```bash
npm install
npm run dev
```

Local Supabase starts automatically and pending local migrations are applied. Only run one dev server for this project at a time.

## deploy

Cloudflare builds/deploys from GitHub. `npm run build` automatically runs every pending Supabase migration **before** building whenever `SUPABASE_DB_URL` exists.

One-time setup: in the Cloudflare Worker's **Settings → Builds → Variables and secrets**, add `SUPABASE_DB_URL` as a **secret**. Use the production Supabase Postgres connection string (with the password URL-encoded if needed). Keep the build command as `npm run build` and deploy command as `npx wrangler deploy`.

After that, normal pushes are enough:

```bash
git add . && git commit -m "update" && git push
```

Supabase tracks migration history, so `db push` applies only new files in `supabase/migrations`.

### Local `SQLITE_BUSY`
`npm run dev` now cleans only this checkout's stale Cloudflare runtime and starts Vite in its own process group, so Ctrl-C also stops any child `workerd` process. It also removes the complete disposable `.wrangler/` directory before startup. Your actual local app data remains in Supabase/Docker.

## local dev

`npm run dev` starts local Supabase, applies local migrations, then starts Vite without Cloudflare runtime emulation. Production builds still use the Cloudflare adapter. This keeps local development out of workerd/Miniflare SQLite entirely.

### Local account testing
`npm run dev` starts local Supabase Auth with email signup explicitly enabled and Mailpit available for password-reset email testing. Signup errors are now surfaced in the UI instead of being collapsed into “could not continue”. Local email confirmation is disabled; production confirmation/reset behavior is controlled by the production Supabase Auth settings.
