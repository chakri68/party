#!/usr/bin/env node
// Headless Web export of the Blind Rally navigator (repo map §3.3).
//
//   node games/blind-rally/scripts/export-godot.mjs [--no-export]
//
// 1. Writes data/tracks.json from the track scenes (godot/tools/export_tracks.gd),
//    then exports into games/blind-rally/build/web/ (gitignored), copies the bridge
//    probe in as probe.html, and prints every file's size plus the brotli size
//    of the .wasm. --no-export skips this and publishes whatever's there.
// 2. Hashes the export (sha256 over names and bytes, first 10 hex) and copies
//    it to apps/web/public/blind-rally/godot/<hash>/ with Godot's own file
//    names: its loader derives .wasm/.pck/worklets from one base name, so
//    per-file hashing would break it. Older hash dirs are pruned.
// 3. Writes client/navigator/godot-build.json = {hash, base, files, sizes}.
//    The navigator chunk imports it, so one JS build names exactly one export
//    and a stale .pck can't meet a fresh .wasm.
//
// Still to come: the R2 upload of the hash dir for deploys (D2). Dev just serves apps/web/public via Vite.
//
// GODOT_BIN overrides the binary; otherwise `godot` on PATH, then ~/.local/bin/godot.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const project = join(pkg, 'godot');
const out = join(pkg, 'build', 'web');
const publicRoot = resolve(pkg, '..', '..', 'apps', 'web', 'public', 'blind-rally', 'godot');
const manifestPath = join(pkg, 'client', 'navigator', 'godot-build.json');
const MiB = 1024 * 1024;
/** Ours, not Godot's: they stay in build/web and never get published. */
const UNPUBLISHED = new Set(['probe.html', 'sizes.json']);
const skipExport = process.argv.includes('--no-export');
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

function exportWeb() {
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
  // data/tracks.json comes from the same scenes the export packs (map §3.5),
  // so the server's gates can't drift from the Navigator's.
  run(godot, ['--headless', '--path', project, '--script', 'res://tools/export_tracks.gd']);
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
}

function publish() {
  if (!existsSync(join(out, 'index.html'))) throw new Error(`nothing exported in ${out}: run without --no-export first`);
  const files = readdirSync(out).filter((f) => !UNPUBLISHED.has(f)).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update('\0').update(readFileSync(join(out, f))).update('\0');
  const id = hash.digest('hex').slice(0, 10);

  const dir = join(publicRoot, id);
  mkdirSync(dir, { recursive: true });
  const sizes = {};
  for (const f of files) {
    copyFileSync(join(out, f), join(dir, f));
    sizes[f] = statSync(join(dir, f)).size;
  }
  for (const old of readdirSync(publicRoot)) if (old !== id) rmSync(join(publicRoot, old), { recursive: true, force: true });

  const manifest = { hash: id, base: `/blind-rally/godot/${id}/`, files, sizes };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\npublished ${files.length} files to apps/web/public/blind-rally/godot/${id}/`);
  console.log(`wrote ${manifestPath}`);
}

if (!skipExport) exportWeb();
publish();
