# 3tap

**three states. one tap.**

A tiny three-state daily habit grid for **3tap.cc**.

Each cell cycles:

`-` → `|` → `+` → `-`

No accounts. A board is created automatically on first visit. To sync another device, scan the pairing QR code or open the sync link. Possession of the board secret is the authentication model.

## Stack

- SvelteKit 2 + Svelte 5
- Supabase Postgres
- Vercel
- PWA service worker
- QR device pairing

## Local setup

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

4. Install and run:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy to 3tap.cc

1. Push this repository to GitHub.
2. Import it into Vercel.
3. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel → Project Settings → Environment Variables.
4. Deploy.
5. In Vercel → Project Settings → Domains, add `3tap.cc` and `www.3tap.cc`.
6. In Namecheap → Domain List → 3tap.cc → Advanced DNS, add the DNS records Vercel shows you.
7. Make `3tap.cc` the primary domain and redirect `www.3tap.cc` to it.

Pairing links are generated from `location.origin`, so production QR codes automatically use `https://3tap.cc/pair#...`. No domain string needs to be hard-coded in the app.

## Sync model

- First visit creates a board and a random 256-bit secret.
- Only SHA-256(secret) is stored in the database.
- The raw secret is stored locally on each paired device.
- API requests send it as a bearer token over HTTPS.
- Pair links use the URL fragment (`#...`), so the raw secret is not sent in the initial HTTP request or server logs.
- The UI is optimistic and caches the board locally.
- Failed taps are queued in localStorage and replayed when connectivity returns.
- Devices refresh every 3 seconds and whenever the app regains focus.

## V1 scope

Included:

- automatic anonymous board
- default habit list
- `- | +` tap cycling
- one date column per day from board creation through today
- automatic new day detection
- responsive sticky habit column
- QR / link device pairing
- recovery code
- edit/add/remove/reorder habits
- local cache + simple offline mutation queue
- JSON export
- installable PWA

Deliberately excluded:

- accounts
- passwords
- streaks
- analytics
- reminders
- social features
- categories
- scores
- notifications

## Security note

The recovery code / pairing link is effectively the password. Anyone who possesses it can access the board. This tradeoff is intentional to keep 3tap accountless and frictionless.
