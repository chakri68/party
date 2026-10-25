#!/usr/bin/env node
// Headless Web export of the Blind Rally navigator (repo map §3.3, M0 step 3).
//
//   node games/blind-rally/scripts/export-godot.mjs
//
// Writes games/blind-rally/build/web/ (gitignored), copies the bridge probe in
// as probe.html, and prints every file's size plus the brotli size of the
// .wasm. Hashing, the copy into apps/web/public and the R2 upload (decision D2:
// deploy serves these from R2 through the Worker) come in M1 step 7.
//
// GODOT_BIN overrides the binary; otherwise `godot` on PATH, then ~/.local/bin/godot.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const project = join(pkg, 'godot');
const out = join(pkg, 'build', 'web');
const MiB = 1024 * 1024;
const WORKERS_ASSET_LIMIT = 25 * MiB;

function findGodot() {
  if (process.env.GODOT_BIN) return process.env.GODOT_BIN;
  const which = spawnSync('sh', ['-c', 'command -v godot'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const local = join(homedir(), '.local', 'bin', 'godot');
  if (existsSync(local)) return local;
  throw new Error('godot not found: set GODOT_BIN or put godot on PATH');
}

function run(bin, args) {
  const r = spawnSync(bin, args, { cwd: project, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} exited ${r.status}`);
}

const godot = findGodot();
const version = spawnSync(godot, ['--version'], { encoding: 'utf8' }).stdout.trim();
// "4.7.2.stable.official.ed1daf0bf" -> templates live under "4.7.2.stable".
const tplVersion = version.split('.').slice(0, 4).join('.');
const tplDir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'godot', 'export_templates', tplVersion);
const tpl = join(tplDir, 'web_nothreads_release.zip');
if (!existsSync(tpl)) {
  console.error(`missing export template: ${tpl}\ninstall the ${tplVersion} .tpz first (map §5 M0 step 1)`);
  process.exit(1);
}

console.log(`godot ${version}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Import first so a fresh clone (no .godot/) exports the same as a warm one.
run(godot, ['--headless', '--path', project, '--import']);
const t0 = Date.now();
run(godot, ['--headless', '--path', project, '--export-release', 'Web', join(out, 'index.html')]);
console.log(`export took ${((Date.now() - t0) / 1000).toFixed(1)} s`);

copyFileSync(join(project, 'web', 'probe.html'), join(out, 'probe.html'));

const fmt = (n) => `${(n / MiB).toFixed(2).padStart(8)} MiB  ${String(n).padStart(10)} B`;
const files = readdirSync(out).sort();
const sizes = {};
console.log('\nfiles:');
for (const f of files) {
  const n = statSync(join(out, f)).size;
  sizes[f] = n;
  const flag = n > WORKERS_ASSET_LIMIT ? '  > 25 MiB (Workers static asset limit)' : '';
  console.log(`  ${fmt(n)}  ${f}${flag}`);
}

const wasm = files.find((f) => f.endsWith('.wasm'));
if (!wasm) throw new Error('no .wasm in export output');
const t1 = Date.now();
const br = brotliCompressSync(readFileSync(join(out, wasm)), {
  params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: sizes[wasm] },
});
console.log(`\n${wasm}: ${(sizes[wasm] / MiB).toFixed(2)} MiB raw, ${(br.length / MiB).toFixed(2)} MiB brotli-11 (${((Date.now() - t1) / 1000).toFixed(1)} s)`);
console.log(sizes[wasm] > WORKERS_ASSET_LIMIT
  ? '.wasm is over 25 MiB: fine for R2 (D2), would not fit Workers static assets as-is'
  : '.wasm fits under 25 MiB');
const total = Object.values(sizes).reduce((a, b) => a + b, 0);
console.log(`total ${(total / MiB).toFixed(2)} MiB`);

writeFileSync(join(out, 'sizes.json'), JSON.stringify({ godot: version, sizes, wasmBrotli: br.length }, null, 2) + '\n');
