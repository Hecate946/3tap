import { spawn, spawnSync } from 'node:child_process';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function supabase(args, capture = false) {
  const result = spawnSync(npx, ['--yes', 'supabase@latest', ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.status !== 0) throw new Error(capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : `supabase ${args.join(' ')} failed`);
  return capture ? result.stdout : '';
}

function envFrom(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return [];
    return [[match[1], match[2].trim().replace(/^['"]|['"]$/g, '')]];
  }));
}

if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
  console.error('\nstart Docker, then run npm run dev again\n');
  process.exit(1);
}

try {
  supabase(['start', '-x', 'studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,supavisor,mailpit']);
  supabase(['migration', 'up', '--local']);

  const local = envFrom(supabase(['status', '-o', 'env'], true));
  if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error('could not read local Supabase credentials');

  const vite = spawn(npx, ['vite', 'dev'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SUPABASE_URL: local.API_URL,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY
    }
  });

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => vite.kill(signal));
  vite.on('exit', (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 0));
} catch (error) {
  console.error(`\n3tap dev failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
