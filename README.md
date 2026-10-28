# party games.

Party games for a group chat, played on phones. No accounts, no app: a name, a room code, and you're in.

Twenty of them, roughly:

- **Cards**: Sevens, Crazy Eights, Old Maid, Go Fish, President, Cheat
- **Words and drawing**: Scribbl, Pass the Bomb, Chain Words, Fake Word, Bluff Definitions, Don't Say It, Face-Off
- **Hidden roles**: Imposter, Short Night, Heist, Nightfall
- **Racing**: Blind Rally, Rally (hosted site only, see [below](#blind-rally-and-its-flag))
- **Strategy**: Dominion

How to play each one, and how rooms work: **[docs/games](docs/games/README.md)**.

The copy at [party-games.chakri.me](https://party-games.chakri.me) is invite-only (only I can open rooms there, so it doesn't turn into a free-for-all). Run your own instead. It takes one command.

## Host your own

```sh
npx github:chakri68/party
```

You need [Node.js 22+](https://nodejs.org). For the default tunnel you also need `ssh`, which macOS, Linux and Windows 10+ already have.

What it does:

1. Asks how friends should reach you: [localhost.run](https://localhost.run) (default, over ssh) or a Cloudflare quick tunnel.
2. Installs and builds the game into `~/.party-games`. The first run takes a minute or two; later runs are quick.
3. Starts the server on your machine and puts a public tunnel in front of it.
4. Prints your **host link** and opens it. Hit *Create room*, then share the room link from inside the room. Friends just open it.

Keep the terminal open while you play. Ctrl+C stops everything.

The host link has an owner key in it (`#owner=…`), and that key is what lets you create rooms, so keep it to yourself. Each run makes a new key and a new public URL, so old links die when you stop.

### Options

```
--tunnel <name>   localhost.run (default) or cloudflare
--port <number>   local port for the server (default: any free one)
--dir <path>      where to keep the app (default: ~/.party-games)
```

### How it works

The server is a Cloudflare Worker with one Durable Object per room. `wrangler dev` runs that same worker locally on workerd, so you don't need a Cloudflare account. The tunnel forwards a public HTTPS address to it, websockets included. Rooms live on your machine and vanish when you stop the server.

If the localhost.run tunnel drops, the CLI reconnects and prints the new links. Games in progress carry on, but everyone needs the new address.

## Development

```sh
pnpm install
pnpm dev        # vite + wrangler dev, owner key "dev" (open /#owner=dev)
pnpm test
pnpm typecheck
pnpm host       # the self-host CLI, from this checkout
```

Games live in `games/<name>` (rules, server logic and client view in one package), the shell in `apps/web`, and the worker in `apps/server`.

### Blind Rally and its flag

Blind Rally's Navigator runs a Godot export that isn't in git: a ~38 MiB `.wasm` has no business in a repo. So the game only exists in builds that ship one. Rally (`rally-spec.md`) is the same package and the same export with the blindfold off, so it rides the same flag:

- `VITE_BLIND_RALLY=1` at build time puts both in the lobby's game list. Without it, Vite drops the entries and all their chunks.
- `BLIND_RALLY=1` on the worker lets a room pick either. Without it, `select-game` says "Unknown game."

`pnpm dev` sets both (`apps/web/.env.development`, `--var BLIND_RALLY:1`). `pnpm run deploy` sets both too (`scripts/deploy.mjs`). `pnpm host` sets neither, so self-hosted copies never list a game they can't load; its worker 404s the engine files as well, even if they're sitting in `dist`.

To get the export into dev: `node games/blind-rally/scripts/export-godot.mjs` (needs Godot 4.7.2 and its web templates; `--no-export` republishes whatever's already in `games/blind-rally/build/web`). It copies the build into `apps/web/public/blind-rally/godot/<hash>/` and writes `games/blind-rally/client/navigator/godot-build.json`, which pins the client to that hash.

### Deploying it

The `.wasm` is over Workers' 25 MiB static-asset limit, so deploys don't ship the export as assets. It lives in an R2 bucket (`party-games-blind-rally`, binding `BLIND_RALLY_GODOT`) and the worker serves it at the same path the client already asks for, `/blind-rally/godot/<hash>/<file>` (`apps/server/src/godot.ts`). Same origin matters: the Navigator's iframe bridge pokes `iframe.contentWindow`, which a bucket on its own domain wouldn't allow.

```sh
pnpm run deploy               # not `pnpm deploy`: that's pnpm's own command
pnpm run deploy -- --dry-run  # prints the uploads, ends in `wrangler deploy --dry-run`
```

That uploads the hash `godot-build.json` names, builds with `VITE_BLIND_RALLY=1`, drops the export from `dist`, and runs `wrangler deploy --var BLIND_RALLY:1`. The upload goes first so a new worker never names a hash the bucket hasn't got. Run the export before deploying a Godot change; deploying without one reuses the last hash, and that's a no-op upload.

How the upload works (`export-godot.mjs --upload`): `.wasm`, `.pck`, `.js` and `.html` go up brotli-11 with `Content-Encoding: br` in their R2 metadata, and the worker returns them byte-for-byte with `encodeBody: "manual"`. The wasm is ~38 MiB on disk and ~7 MiB on the wire. A `.uploaded` marker goes last; a hash that has one is skipped whole, which makes reruns cheap and a half-finished upload just redo itself. `--local [--persist-to <dir>]` targets `wrangler dev`'s simulated bucket instead, and `--dry-run` prints the puts.

In dev none of this runs. Vite serves `apps/web/public` and never forwards `/blind-rally` to the worker, so the worker's empty local bucket never comes up.
