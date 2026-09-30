# 3tap

A tiny habit tracker I made for myself to stay accountable. Tap a habit once for `|`, twice for `+`, or leave it at `-`.

## stack

SvelteKit + IndexedDB. Everything stays on this browser/device. No accounts, passwords, backend, database server, or sync yet.

## local dev

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## production

```bash
npm run check
npm run build
```

Cloudflare only serves the app now. There are no Supabase or database environment variables to configure.

Habit data is stored in IndexedDB on each device. Clearing site data also clears 3tap data.
