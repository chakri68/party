#!/usr/bin/env node
// Headless Web export of Treasure Hunt. Blind Rally's script, trimmed: no
// tracks step, no probe, no R2 upload. M1 is dev-only, so Vite serving
// apps/web/public is the whole story.
//
//   node games/treasure-hunt/scripts/export-godot.mjs [--no-export]
//
// 1. Exports into games/treasure-hunt/build/web/ (gitignored) and prints every
//    file's size. --no-export skips this and publishes whatever's there.
// 2. Hashes the export (sha256 over names and bytes, first 10 hex) and copies
//    it to apps/web/public/treasure-hunt/godot/<hash>/ with Godot's own file
//    names: its loader derives .wasm/.pck/worklets from one base name, so
//    per-file hashing would break it. Older hash dirs are pruned.
// 3. Writes client/godot/godot-build.json = {hash, base, files, sizes}. The
//    client imports it, so one JS build names exactly one export and a stale
//    .pck can't meet a fresh .wasm.
//
// GODOT_BIN overrides the binary; otherwise `godot` on PATH, then ~/.local/bin/godot.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..');
const project = join(pkg, 'godot');
const out = join(pkg, 'build', 'web');
const publicRoot = resolve(pkg, '..', '..', 'apps', 'web', 'public', 'treasure-hunt', 'godot');
const manifestPath = join(pkg, 'client', 'godot', 'godot-build.json');
const MiB = 1024 * 1024;
const skipExport = process.argv.includes('--no-export');

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
    console.error(`missing export template: ${tpl}\ninstall the ${tplVersion} export templates first`);
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

  const fmt = (n) => `${(n / MiB).toFixed(2).padStart(8)} MiB  ${String(n).padStart(10)} B`;
  let total = 0;
  console.log('\nfiles:');
  for (const f of readdirSync(out).sort()) {
    const n = statSync(join(out, f)).size;
    total += n;
    console.log(`  ${fmt(n)}  ${f}`);
  }
  console.log(`total ${(total / MiB).toFixed(2)} MiB`);
}

function publish() {
  if (!existsSync(join(out, 'index.html'))) throw new Error(`nothing exported in ${out}: run without --no-export first`);
  const files = readdirSync(out).sort();
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

  const manifest = { hash: id, base: `/treasure-hunt/godot/${id}/`, files, sizes };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\npublished ${files.length} files to apps/web/public/treasure-hunt/godot/${id}/`);
  console.log(`wrote ${manifestPath}`);
}

if (!skipExport) exportWeb();
publish();
