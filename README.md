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
