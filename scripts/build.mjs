import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Cloudflare production builds can optionally apply migrations automatically.
// Add SUPABASE_DB_URL once as a Cloudflare build secret. Local builds omit it.
const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (dbUrl) {
  console.log('3tap · applying pending production database migrations');
  run(npx, ['--yes', 'supabase@latest', 'db', 'push', '--db-url', dbUrl, '--include-all']);
}

// Runtime Supabase credentials belong to the Worker itself (Variables & Secrets),
// not just the build environment. The build does not need to expose them.
run(npx, ['vite', 'build']);
