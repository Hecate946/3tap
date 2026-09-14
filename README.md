# 3tap

a tiny habit tracker I made for myself to stay accountable. tap each habit `-` → `|` → `+`, jot thoughts, and look back at history.

## local

```bash
npm install
npm run dev
```

`npm run dev` starts local Supabase, applies pending migrations, and starts Vite. Docker needs to be running.

### password-reset email

3tap owns the account/password database itself and uses Resend only to deliver reset links. There are no recovery codes.

One-time setup:

1. In Resend, add and verify `3tap.cc` as a sending domain.
2. Create a Resend API key.
3. For local development, copy `.env.example` to `.env` and put the key in `RESEND_API_KEY`.
4. For production, add `RESEND_API_KEY` once as a **runtime secret** on the Cloudflare Worker. `RESET_EMAIL_FROM` and `APP_ORIGIN` are already configured in `wrangler.jsonc`.

After that the exact same flow works locally and in production: **forgot password → email → 30-minute single-use link → new password**. Resetting a password signs out existing sessions.

## deploy

Cloudflare deploys from GitHub. Set `SUPABASE_DB_URL` as a Cloudflare **build secret** once; `npm run build` applies pending migrations before every production build. Runtime also needs `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `SUPABASE_URL` (the URL is already in `wrangler.jsonc`).
