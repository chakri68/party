# party games.

Card games and doodles for a group chat, played on phones. No accounts, no app: a name, a room code, and you're in.

Sevens, Crazy Eights, Old Maid, Go Fish, President, Cheat, Scribbl and Pass the Bomb.

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
