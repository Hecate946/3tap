# 3tap

A tiny habit tracker I made for myself to stay accountable. Today is the home screen; the other tabs are Thoughts and History (the grid). Tap a habit once for `|`, twice for `+`, or a third time to clear it. Everything stays in sync between Today and History. Add habits on Today; History opens read-only. Use **edit mode** beneath the grid to update past entries, rename, reorder, or delete habits. The calendar squares turn a uniform yellow and become editable, even for older dates; History stays uncolored in view mode. Drag sideways across the squares to scroll in either mode, or click/tap a square in edit mode to cycle its state. The selected tab is remembered after reloads. **Clear history** removes all check-ins with confirmation but keeps habits and thoughts. Drag the six-dot handle to reorder habits or thoughts; × permanently deletes an item (and habit history). There is no archive.

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
