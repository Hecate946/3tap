import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const projectRoot = realpathSync(process.cwd());
const lockPath = resolve('.3tap-dev.lock');
let ownsLock = false;
let vite = null;

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function releaseLock() {
  if (!ownsLock) return;
  try { rmSync(lockPath, { force: true }); } catch {}
  ownsLock = false;
}

if (existsSync(lockPath)) {
  const oldPid = Number(readFileSync(lockPath, 'utf8').trim());
  if (pidAlive(oldPid)) {
    console.error(`\n3tap dev is already running (pid ${oldPid}). Stop it before starting another copy.\n`);
    process.exit(1);
  }
  rmSync(lockPath, { force: true });
}
writeFileSync(lockPath, String(process.pid));
ownsLock = true;
process.on('exit', releaseLock);

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

function shutdown(signal = 'SIGTERM') {
  releaseLock();
  if (vite?.pid) {
    try {
      // vite is its own process group on Linux/macOS, so this also stops any
      // workerd child instead of leaving it holding the SQLite file open.
      if (process.platform !== 'win32') process.kill(-vite.pid, signal);
      else vite.kill(signal);
    } catch {}
  }
}

try {
  supabase(['start', '-x', 'studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,supavisor']);
  supabase(['migration', 'up', '--local']);
  const local = envFrom(supabase(['status', '-o', 'env'], true));
  if (!local.API_URL || !local.SERVICE_ROLE_KEY) throw new Error('could not read local Supabase credentials');

  vite = spawn(npx, ['vite', 'dev'], {
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, THREE_TAP_LOCAL_DEV: '1', SUPABASE_URL: local.API_URL, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal));
  vite.on('exit', (code, signal) => {
    releaseLock();
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
} catch (error) {
  shutdown();
  console.error(`\n3tap dev failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
