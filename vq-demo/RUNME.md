# vq demo — runbook

## 0. Prerequisite: OpenCode 2.2.4 or newer

```bash
opencode --version            # must print 2.2.4, 2.2.5, 2.3.x …
```

Older than that, and the server says so and stays up — the fix is in the browser, not the terminal. It prints what it found:

```
[OpenCode] binary=/Users/you/.nvm/versions/node/v22/bin/opencode source=path version=1.19.3 (minimum 2.2.4; override with OPENCODE_BINARY=/path/to/opencode)
[OpenCode] Unsupported OpenCode: binary=/Users/you/.nvm/versions/node/v22/bin/opencode source=path version=1.19.3 minimum=2.2.4
[OpenCode] Set OPENCODE_BINARY=/path/to/opencode (2.2.4 or newer) and start OpenChamber again.
```

and the page itself shows **OpenCode v2 required**, with the binary path it checked, an **Update to OpenCode v2** button, and **Check again**. Install from there, or set `OPENCODE_BINARY` and press **Check again**.

Fix it once, in the shell you demo in:

```bash
export OPENCODE_BINARY=/absolute/path/to/opencode    # 2.2.4 or newer
"$OPENCODE_BINARY" --version
```

Also needs Node.js 24.14+ and `bun` on `PATH` (`~/.bun/bin/bun` if it is not).

## 1. Start it — port 3002, never 3000

```bash
cd /path/to/openchamber    # your clone of this repo
bun run --cwd packages/web dev:vq
```

That is the repo's own vq loop: API server on **3902**, Vite UI on **3002** (the script pins both). Open <http://localhost:3002>. Port 3000 is the live app — never point this at it.

Right after `Starting OpenCode …` the run names the binary it resolved:

```
[OpenCode] binary=/Users/you/.opencode/bin/opencode source=path version=2.2.5 (minimum 2.2.4; override with OPENCODE_BINARY=/path/to/opencode)
```

`source` is where that file came from — one of `bundled`, `env`, `fallback`, `path`, `policy`, `settings`, `shell`, `unknown`, `where`, `wsl`. Built UI instead of Vite, if you prefer: `bun run --cwd packages/web build`, then `node packages/web/bin/cli.js serve --port 3002 --foreground`.

## 2. Success

- Ask for judgment over a list, e.g. "triage the rows in backlog.json — keep, drop, or later".
- The reply carries one `vq` fenced block holding a JSON object.
- A deck renders inline in the chat: cards, one item at a time, swipe or keyboard to judge.
- **Submit** sends your answer back, and the assistant's next turn uses it.

## 3. Failure, and the fix for each

- **Browser says "OpenCode v2 required"** → step 0. The server is fine; install from that screen or set `OPENCODE_BINARY` and press **Check again**. Nothing renders until the binary is new enough.
- **Server starts, fence never renders (plain text)** — one of:
  - the log says `Page rendering is off (external OpenCode server)` or `(skip-start)`: drop `OPENCODE_PORT` / `OPENCODE_HOST` / `OPENCODE_SKIP_START` / `OPENCHAMBER_SKIP_OPENCODE_START`, so OpenChamber starts its own server.
  - the log says `page rendering probe failed:` — settings were unreadable; restart.
  - Settings → OpenChamber → Tools → **Charts and mockups** is off. Turn it on.
- **Server starts, no `[OpenCode] binary=` line** → you are attached to a server OpenChamber did not launch. That line is printed once for every managed launch, including one whose binary is rejected, so its total absence means the process is not ours.

## 4. Where the answers land

The fence's `output` decides: `{"kind":"dir","path":"vq-out"}` writes one file per artifact into `vq-out/` **inside the open project**, and an absolute `path` is used as it is. With no `output` key nothing touches the disk — the answer only returns to the assistant.
