// Shared R2 uploader for the Godot web exports (Blind Rally, Treasure Hunt).
// Each game's export-godot.mjs --upload calls uploadGodot() with its own paths.
//
// Puts the dir the game's godot-build.json names into the R2 bucket the Worker
// serves it from (apps/server/src/godot.ts), under <keyRoot>/<hash>/<file>.
// The .wasm, .pck, .js and .html go up brotli-11 with Content-Encoding: br, so
// the ~38 MiB wasm crosses the wire at ~7. A .uploaded marker goes last; if
// it's there the hash is skipped whole, since a content-hashed dir can't have
// changed. That makes it idempotent and a rerun after a half-finished upload
// just redoes it.
// --remote by default; --local targets wrangler dev's simulated bucket,
// --dry-run prints the puts without making them.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc } from 'node:zlib';

const MiB = 1024 * 1024;
const BUCKET = 'party-games-blind-rally'; // apps/server/wrangler.jsonc r2_buckets
const IMMUTABLE = 'public, max-age=31536000, immutable';
const MARKER = '.uploaded';
const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',
  pck: 'application/octet-stream',
  png: 'image/png',
};
/** PNGs are already compressed; brotli would just spend time saying so. */
const BROTLI = new Set(['html', 'js', 'wasm', 'pck']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = join(repoRoot, 'apps', 'server');
const wranglerJs = join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function wrangler(args, opts = {}) {
  // Run from apps/server so wrangler picks up wrangler.jsonc (account, bucket).
  return spawnSync(process.execPath, [wranglerJs, ...args], { cwd: serverDir, encoding: 'utf8', maxBuffer: 64 * MiB, ...opts });
}

/**
 * @param {{ manifestPath: string, publicRoot: string, stagingRoot: string, keyRoot: string, argv: string[] }} o
 *   stagingRoot holds the brotli copies, one dir per hash; keyRoot is the R2 key prefix.
 */
export function uploadGodot({ manifestPath, publicRoot, stagingRoot, keyRoot, argv }) {
  const argValue = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const dryRun = argv.includes('--dry-run');
  const where = argv.includes('--local') ? ['--local'] : ['--remote'];
  const persist = argValue('--persist-to');
  if (persist) where.push('--persist-to', resolve(persist));

  if (!existsSync(manifestPath)) throw new Error(`no ${manifestPath}: run the export first`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const dir = join(publicRoot, manifest.hash);
  // The client is pinned to this hash, so upload exactly what it names.
  for (const f of manifest.files) {
    const p = join(dir, f);
    if (!existsSync(p)) throw new Error(`${p} is missing: rerun the export (or --no-export) so apps/web/public matches godot-build.json`);
    if (statSync(p).size !== manifest.sizes[f]) throw new Error(`${p} doesn't match godot-build.json's size: rerun the export`);
  }

  const prefix = `${keyRoot}/${manifest.hash}`;
  console.log(`${dryRun ? '[dry run] ' : ''}upload ${manifest.hash} to r2://${BUCKET}/${prefix}/ (${where.join(' ')})`);

  if (!dryRun) {
    const probe = wrangler(['r2', 'object', 'get', `${BUCKET}/${prefix}/${MARKER}`, '--pipe', ...where]);
    if (probe.status === 0) {
      console.log(`already uploaded (${MARKER} is there): nothing to do`);
      return;
    }
    if (!/does not exist/i.test(probe.stderr + probe.stdout)) {
      process.stderr.write(probe.stderr);
      throw new Error('checking the bucket failed (logged in? does the bucket exist?)');
    }
  }

  const staging = join(stagingRoot, manifest.hash);
  if (!dryRun) mkdirSync(staging, { recursive: true });
  const puts = [];
  for (const f of manifest.files) {
    const ext = f.slice(f.lastIndexOf('.') + 1);
    const src = join(dir, f);
    const meta = ['--content-type', CONTENT_TYPES[ext] ?? 'application/octet-stream', '--cache-control', IMMUTABLE];
    let file = src;
    let size = manifest.sizes[f];
    if (BROTLI.has(ext)) {
      file = join(staging, `${f}.br`);
      meta.push('--content-encoding', 'br');
      if (!dryRun) {
        if (!existsSync(file)) {
          const raw = readFileSync(src);
          writeFileSync(file, brotliCompressSync(raw, {
            params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length },
          }));
        }
        size = statSync(file).size;
      }
    }
    puts.push({ key: `${prefix}/${f}`, file, meta, size, br: BROTLI.has(ext) });
  }
  // Last, so its presence means everything before it landed.
  const marker = join(staging, MARKER);
  if (!dryRun) writeFileSync(marker, `${new Date().toISOString()}\n`);
  puts.push({ key: `${prefix}/${MARKER}`, file: marker, meta: ['--content-type', 'text/plain'], size: 0, br: false });

  for (const put of puts) {
    const args = ['r2', 'object', 'put', `${BUCKET}/${put.key}`, '--file', put.file, ...put.meta, ...where];
    const label = `${(put.size / MiB).toFixed(2).padStart(7)} MiB${put.br && !dryRun ? ' br' : put.br ? ' raw, br on upload' : ''}`;
    if (dryRun) {
      console.log(`  ${label}  wrangler ${args.map((a) => (/[\s;]/.test(a) ? `'${a}'` : a)).join(' ')}`);
      continue;
    }
    console.log(`  ${label}  ${put.key}`);
    const r = wrangler(args, { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.status !== 0) throw new Error(`upload of ${put.key} failed (exit ${r.status}); rerun to retry`);
  }
  console.log(dryRun ? '[dry run] nothing uploaded' : `uploaded ${puts.length} objects`);
}
