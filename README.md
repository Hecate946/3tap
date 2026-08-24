# 3tap

tiny three-state habit grid + quick thoughts.

```bash
npm run dev
```

## fake history

dev only. these never sync, never touch your real board, and do nothing in production.

- `/?fixture=empty`
- `/?fixture=1d`
- `/?fixture=2d`
- `/?fixture=7d`
- `/?fixture=31d`
- `/?fixture=6mo`
- `/?fixture=late` — habits added at different times
- `/?fixture=sparse`

example: `http://localhost:5173/?fixture=31d`

refresh to reset the fixture.

## send the source

```bash
npm run site:zip
```

creates `3tap-source.zip` in the project root. it includes the source/config/migrations and skips dependencies, build output, env files, secrets, and old zips.
