import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dbUrl = process.env.SUPABASE_DB_URL?.trim();

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Cloudflare runs `npm run build` for every Git push. If the production
// database URL is configured as a secret, migrations are applied first.
// `supabase db push` records applied migrations, so old migrations are skipped.
if (dbUrl) {
  console.log('3tap · applying pending Supabase migrations');
  run(npx, ['--yes', 'supabase@latest', 'db', 'push', '--db-url', dbUrl, '--include-all']);
} else {
  console.log('3tap · SUPABASE_DB_URL not set; skipping remote migrations');
}

run(npx, ['vite', 'build']);
