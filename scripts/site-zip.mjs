import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const output = '3tap-source.zip';
rmSync(output, { force: true });

const exclusions = [
  '.git/*',
  'node_modules/*',
  '.svelte-kit/*',
  '.wrangler/*',
  'build/*',
  'dist/*',
  'coverage/*',
  'supabase/.temp/*',
  'supabase/.branches/*',
  '*.zip',
  '.DS_Store',
  '.env',
  '.env.local',
  '.env.*.local',
  '.dev.vars',
  '.dev.vars.*',
  'secrets.txt',
  'npm-debug.log*'
];

const result = spawnSync('zip', ['-q', '-r', output, '.', '-x', ...exclusions], { stdio: 'inherit' });
if (result.error?.code === 'ENOENT') {
  console.error('zip is not installed');
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(output);
