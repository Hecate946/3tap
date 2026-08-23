# 3tap

a tiny habit tracker.

`-` missed · `|` done · `+` great

only today is editable. old days lock. drag habits to reorder them. no login, no streaks, no charts.

boards are anonymous and sync through supabase. pair another device with the qr code, or save the recovery phrase somewhere safe.

## local

Docker needs to be running.

```bash
npm run dev
```

that starts local Supabase, applies migrations, and runs the site at `http://localhost:5173`.

useful stuff:

```bash
npm run check
npm run db:reset
npm run db:stop
```

## prod

Cloudflare Worker + Supabase.

`SUPABASE_URL` lives in `wrangler.jsonc` because it isn't secret.

Cloudflare keeps these as secrets:

- `SUPABASE_SERVICE_ROLE_KEY` — Worker runtime
- `SUPABASE_DB_URL` — build-time migrations

push to GitHub and Cloudflare builds/deploys it.

`/api/health` is there when prod is acting weird.
