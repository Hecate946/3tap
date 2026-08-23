import { spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const production = process.env.VERCEL_ENV === 'production';

function requireProductionEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`\nMissing ${name} in Vercel Production environment variables.`);
    console.error('Refusing to deploy a 3tap production build with a broken database configuration.\n');
    process.exit(1);
  }
  return value;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (production) {
  requireProductionEnv('SUPABASE_URL');
  requireProductionEnv('SUPABASE_SERVICE_ROLE_KEY');
  const dbUrl = requireProductionEnv('SUPABASE_DB_URL');

  console.log('3tap · applying pending production database migrations');
  run(npx, ['--yes', 'supabase@latest', 'db', 'push', '--db-url', dbUrl, '--include-all']);
}

run(npx, ['vite', 'build']);
