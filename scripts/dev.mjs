import { spawn, spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, options = {}) {
  const result = spawnSync(npx, ['--yes', 'supabase@latest', ...args], {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    throw new Error(detail || `supabase ${args.join(' ')} failed`);
  }
  return options.capture ? result.stdout : '';
}

function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (docker.status !== 0) {
  console.error('\n3tap local database needs Docker running. Start Docker, then run npm run dev again.\n');
  process.exit(1);
}

try {
  console.log('3tap · starting local database');
  run([
    'start',
    '-x',
    'studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,supavisor,mailpit'
  ]);

  // If a migration was added since the local stack last started, apply it without
  // resetting the developer's local habit data.
  run(['migration', 'up', '--local']);

  const status = parseEnv(run(['status', '-o', 'env'], { capture: true }));
  const url = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('Could not read local Supabase credentials');

  console.log('3tap · local DB ready · http://localhost:5173');
  const vite = spawn(npx, ['vite', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
      THREETAP_ENV: 'development'
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => vite.kill(signal));
  }
  vite.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} catch (error) {
  console.error(`\n3tap dev startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
