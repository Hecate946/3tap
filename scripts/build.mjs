import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const dbUrl = process.env.SUPABASE_DB_URL?.trim();

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (dbUrl) {
  console.log('3tap · applying database migrations');
  run(npx, ['--yes', 'supabase@latest', 'db', 'push', '--db-url', dbUrl, '--include-all']);
}

run(npx, ['vite', 'build']);
