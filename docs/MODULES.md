# Modules

A module is the unit of feature in atelier — a folder with a `frontend.jsx` and/or a `backend.js`. The shell discovers it, mounts its backend, serves its frontend, and gives it a thin, stable contract: an HTTP route namespace, a real-time channel, a slot for cross-module state, and (from the active chrome) UI primitives. Everything else is just React, Tailwind, and the browser.

This page covers building an ordinary module, then the two **special modules** — the **chrome** (which owns the visuals) and the **auth** module (covered in [AUTH.md](./AUTH.md)).

## Folder & file conventions

The shell discovers modules by walking the instance root (and one level into each `$<ws>/`). A handful of names and prefixes are special — this is the complete set:

| Name / prefix | Meaning |
|---|---|
| `frontend.jsx` / `backend.js` | A directory containing **either** is a **module** (its dir name is the id). A folder with neither is ignored. |
| `$<name>/` | A **workspace** (see [Workspaces](./WORKSPACES.md)) — discovery recurses one level in; its subdirectories are that workspace's modules. |
| `_` · `.` · `-` · space prefix | **Excluded** from discovery (`_archive/`, `.git/`, …). Prefix a folder with `_` or `.` to keep it out without renaming. |
| `atelier` · `api` · `assets` · `modules` · `global` | **Reserved** — rejected as both a module dir name and a workspace name: the shell itself (`atelier`) + its URL namespaces (`/api`, `/assets`, `/modules`) + the synthetic `global` workspace. |
| `data/` | Per-module **runtime state** (`<module>/data/`) — never served to clients, ignored by the hot-reload watcher, never touched by the shell. |
| `node_modules/` | A module's own **dependencies** — resolved at runtime, never served, ignored by the watcher. |
| `package.json` | A module's deps manifest (optional — only if it imports npm packages). |
| `module.json` | The module's **declaration** (optional) — see [module.json](#modulejson--the-declaration). |
| `.claude/` | The module's **definitional content** (skills, commands, hooks) — travels with the folder; the shell doesn't read it. |
| `kit.js` / `kit.jsx` | **Chrome only** — a chrome publishing `@atelier/kit` (see [the chrome](#special-module-the-chrome)). |
| `styles.css` | **Chrome only** — the chrome's design tokens, injected via `<link>` (the shell ships none). |

A module id (and a workspace name, after the `$`) must match `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`; anything else is skipped with a one-line warning.

## Module convention

A module is just code — its directory name is the id and default display name. (Modules inside a `$<ws>/` workspace work the same, one level deeper — see [Workspaces](./WORKSPACES.md).)

**Minimal module** — one file:

```jsx
// hello/frontend.jsx
export default function Module() {
  return <div className="p-8">hello</div>;
}
```

### module.json — the declaration

The declaration every app carries; unknown keys are ignored and reported. A module may carry a `module.json` beside its files:

```json
{ "name": "Reading list", "icon": "book-open", "group": "tools", "color": "teal", "primary": false,
  "release": "node migrate.js", "agent": { "tools": ["add_item"], "teaching": "AGENT.md" } }
```

| key | meaning |
|---|---|
| `name` | The name in the sidebar and the title. Up to 64 characters. |
| `icon` | An icon name, or an emoji. Drawn by the frame, never imported by the app. |
| `group`, `color` | A heading the sidebar may group under; the app's accent. |
| `primary` | A request to land on this app when its place opens. |
| `release` | One shell command the host runs at a push, before the switch. Read, not run, by a local instance. |
| `agent` | `{ tools, teaching }`: the calls the agent gets, and one page on when to use them. `tools` names them (lower case, digits, underscores); `teaching` is a file in the module's folder. Read, not acted on, by a local instance. See *Tools: the calls an agent gets*, below. |

`atelier start` reads it with the module's `meta`: `name`, `icon`, `group`, `color` and `primary` from `module.json` win where present, so the chrome draws them. An unknown key, or a value of the wrong kind, is ignored and reported once per edit (`! global/kb/module.json: unknown key "colour", ignored`). **Without a `module.json` a module runs on its `meta`** (below), which is all there is. A folder is a module only when it has a `frontend.jsx` or a `backend.js`.

### Tools: the calls an agent gets

A module can be a tool for an agent as well as an app for people. Behind a host, when someone lets their agent use the app ("Let the agent use Notes"), each tool it declares is mounted into that agent's sandbox, and the agent can call it; the call reaches the module through the host, never straight from the agent. Three pieces:

1. **`module.json` declares them**: `"agent": { "tools": ["add_note", "list_notes"], "teaching": "AGENT.md" }`. A module without `agent.tools` has no tools.
2. **`AGENT.md` says when** to use them: one short page, written to the agent. It reaches the agent with the tools.
3. **`backend.js` implements them**, as a second export beside `mountRoutes`:

```js
export default {
  tools(ctx) {
    return {
      add_note: {
        description: 'Add a short note to the shared list everyone in this chat sees.',
        input: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },   // JSON Schema
        async run({ text }) {
          const who = ctx.caller            // { persona, name, sandbox, chat, word? }: the agent that called, and for whom, as the host verified it
          // … do it, under ctx.dataDir like any route …
          return 'noted'                    // any JSON value: what the agent gets back
        },
      },
    }
  },
  mountRoutes(router, ctx) { /* the app's own routes, unchanged */ },
}
```

`run(args)` gets the arguments as one object and returns any JSON value. `ctx.caller` is the agent's caller: `{ persona, name, sandbox, chat, word? }` (a person's frame gives `{ person, name }`). `word` is `{ person, name }`, the person whose chat message the agent made the call for, when it named one: the host proved that message is theirs, in that chat, and recent. Absent, the agent named nobody. The app decides what that person may do: Notes files the note as theirs, filed by the agent. Throw an `Error` with a `statusCode` (`400`, `403`, `404`) to refuse a call with that sentence; anything else that throws is a `500` with its message. A name declared and not implemented, or implemented and not declared, is reported at start and not served. `tools(ctx)` is called once, when the module starts.

Where it runs: `module-serve.js` (the process a host's computer runs for one module) serves the declared tools on its socket, to its computer only:

- `GET /api/<ws>/<id>/tools` → `{ tools: [{ name, description, input }], teaching }`, read once the module listens, and reported to the host as what the module offers;
- `POST /api/<ws>/<id>/tools/<name>` with the arguments → `200 { result }` or `4xx/500 { error }`. A caller without `sandbox` (a person's frame) is refused `403`; the computer's address never serves these paths to a frame anyway.

A local instance (`atelier start`) reads the declaration and does nothing with it: there is no agent to mount it into.

**Optional metadata** — `export const meta`:

```jsx
export const meta = { icon: 'activity', name: 'Activity', group: 'marketing' };
export default function Module() { ... }
```

Supported keys:
- `icon` — a rail-icon *name* (a string) the **active chrome** renders; the shell ships no icons. Don't `import` an icon library in a module — module frontends are transformed per-file, not bundled, so only `react` / `react-dom` / `@atelier/kit` resolve; just name the icon and let the chrome draw it. A chrome picks the icon set — [lucide](https://lucide.dev/icons) names like `chef-hat` / `layout-dashboard` are a common choice; how an unknown name is handled (e.g. a square fallback) is the chrome's call.
- `name` — display name (rail label).
- `group` — rail section: modules with the same `group` render under a shared header; untagged modules live under the default "modules" section.
- `primary` — boolean; the module the shell lands on at `/` for its workspace.
- `hidden` — boolean; keep the module out of the rail and `defaultUser` (chromes set this on themselves).
- `isChrome` — boolean; marks a global-workspace module as a chrome (see [Special module: the chrome](#special-module-the-chrome)).
- `chrome` — string; the **id of a chrome** this module should render inside, instead of the instance default (see [Per-module chrome](#per-module-chrome--metachrome)). Optional but **recommended for any module that imports `@atelier/kit`**; if the named chrome isn't installed the page shows a clear "chrome not installed" error **inside the default chrome** (no silent fallback — see [Per-module chrome](#per-module-chrome--metachrome)).
- `color` — reserved for future use.

`meta` is optional; the rail falls back to `icon: 'square'` and `name: <dir>`. It's read server-side at discovery and shipped in the HTML bootstrap, so grouping renders on first paint with no flicker. Frontend bundles load **lazily** — a page load fetches the chrome plus the module being viewed, and other modules load on first visit. A module whose frontend must be live on *every* page (it exports a `TopBarCenter` topbar slot, or runs a global listener at import) declares `eager: true` in its meta; without the flag its slot never renders, because its bundle is simply never fetched. A **pure object literal is the fast path** — read straight from source, nothing executes. A *computed* meta (a template literal, a module-scope constant, a spread) also works: the shell evaluates the module in a **disposable sandbox process** — browser globals and every import stubbed with inert proxies, the process killed after the read — so top-level side effects never touch the server. If neither path can read it, discovery logs a warning naming the module and the reason, and the meta is ignored (never half-applied). Prefer the literal: it's instant, deterministic, and can't fail.

### Backend — `backend.js`

Routes are scoped: the shell mounts them at `/api/<workspace>/<id>`, so handlers register *relative* paths.

```js
export default {
  mountRoutes(router, ctx) {
    // Mounts at /api/global/hello/say (or /api/<ws>/hello/say in a workspace).
    router.get('/say', (req, res) => res.json({ ok: true }));
  },
};
```

`ctx` exposes exactly: `id`, `name`, `workspace`, `qualifiedId` (`'<workspace>/<id>'`), `label`, `port`, `host`, `baseUrl`, `dataDir`, `log`, `broadcast`, `module`, `caller` — and nothing else (no CORS or auth helpers; a module that needs CORS sets its own response headers). URLs you return in response bodies — for clients to follow — should be built off the module's mount point (`/api/${ctx.qualifiedId}/...`), never hardcoded. A module that opens its own listener (a sidecar) should bind `ctx.host` (also published as `process.env.HOST`) so it's never more exposed than the instance itself — that pattern, plus reader-relative links and frontends reaching sidecar ports, is in [Recipes](./RECIPES.md).

The router gives handlers `req.params`, `req.query`, `req.json()` (memoized, async; reads a body only when it says `content-type: application/json`, else rejects with a `415`; rejects with a `413` past a 10 MB body cap), `req.user` (see [AUTH.md](./AUTH.md)), and `res.json(data, status?)`.

### Who is calling — `ctx.caller`

A backend reads who is calling from `ctx.caller` and applies its own rules to its own data/; it never authenticates anyone, it judges. Read `ctx.caller` inside a handler (it is per request; outside one it is `null`):

```js
router.get('/notes', (req, res) => {
  const who = ctx.caller            // { person, name, … } or null
  res.json(notes.filter((n) => n.owner === who?.person))
})
```

What it holds depends on where the instance runs, and is never more than who is calling:

- **A plain instance, ungated:** `null`. Nobody was verified.
- **A plain instance with an `auth` module:** `{ person, name }` from the user the gate resolved.
- **Hosted** (the [`hosted`](./README.md#settings) setting): what the host verified in front of the shell — the `X-Atelier-Caller` header (base64url JSON, set by the host after it verified the caller), else the host's `person(req)` answer. Without the setting the header is ignored and removed before the request reaches the module, so it cannot be spoofed.
- **On a host's computer** (`module-serve.js`, behind the computer's address): for a person's frame, `{ person, name, via }`, where `via` is the mount the person came through — `{ kind: 'person' }` when the app was added for them, `{ kind: 'chat', chat, name }` when it was added for a chat they are in (the chat's id and the name people see for it). Everything in it is what the host verified. A module that keeps a chat's data apart writes its rule from `via` (everyone may hand in, only the finance chat may read: check `via.kind === 'chat' && via.chat === …`). For an agent's tool call: `{ persona, name, sandbox, chat, word? }` (below).

On a host's computer two more things hold. A write reaches the module only from the app's own page (the computer's address refuses a request that is not `GET`/`HEAD` unless the browser says it came from the app's own origin), and a body of the kinds any page may send without asking (`text/plain`, a form, multipart) is refused `415` before any route runs. And only the frontend leaves the computer: `frontend.jsx`, the module's files it imports by a relative path, and the files under its `assets/` folder; a backend's own files (`db.js`, an import script) are never served.

### A process per backend

A module that crashes or loops takes down its own process and nothing else. Every `backend.js` runs in its own node process, started by the shell, which forwards the module's `/api/<ws>/<id>/…` to it and carries its `ctx.broadcast` onto its real-time topic. The contract is the same: `mountRoutes(router, ctx)`, the scoped router, the teardown it returns. What a module can notice:

- **Modules share no memory.** `ctx.module(id)` is a plain object inside the module's own process: it does not reach another module, and it does not survive a save (a save starts a fresh process). Talk to another module through its API.
- **A crash ends the process, not just a request.** An uncaught throw, `process.exit()`, running out of memory, or a loop (no answer to the shell's ping for 10 s) ends that process. The shell logs one line, the module's lane answers `500` with the error (and the overlay shows it) while it is down, and a fresh process starts after 1 s, then 2 s, 4 s … at most 30 s; the wait goes back to 1 s once a process has stayed up a minute. Every other module keeps running.
- **`process.cwd()` and the environment** are the shell's (`PORT`, `HOST`, `BASE_URL`).
- **The configured `auth` module stays in the shell's process.** It is the shell's gate (`authenticate` / `authorize` / `handleUnauth` run on every request), not a feature module.

### Frontend self-reference (workspace-aware, never hardcoded)

A module's `frontend.jsx` must derive its API base and WS topic from where it's actually mounted, so the same bundle works in any workspace (`global` is just the default). Use the shell helper — pass it this bundle's `import.meta.url`:

```js
const self = window.__atelier.self(import.meta.url);
// self.workspace 'global' | '<ws>'   self.id 'kanban'   self.qid '<ws>/kanban'
// self.api  '/api/<ws>/kanban'        self.topic '<ws>/kanban' (the WS topic)

self.subscribe((frame) => { … });        // listens on self.topic — workspace-aware
const unsub = self.subscribe(handler);    // returns an unsubscribe fn
fetch(self.api + '/items');               // hits /api/<ws>/kanban/items
```

This mirrors how backend routes are workspace-scoped: just as `router.get('/items')` becomes `/api/<ws>/<id>/items` without naming the workspace, `self.subscribe(...)` listens on `<ws>/<id>` without hardcoding it. **Never write a literal topic or `/api/<name>/...` path** — the workspace can change (the same module under a different `$<ws>/`), and a hardcoded topic would silently miss its own frames. For cross-module calls, reach peers under the same workspace: `/api/${self.workspace}/<peer>/...`.

### Dependencies

Most modules are one file and need nothing. A module that imports a third-party package declares it in its own `<module>/package.json` and runs `npm install` inside that module's directory. **In `backend.js`, load a node_modules dependency with `createRequire(import.meta.url)('pkg')` — not a static `import`** — because the backend is bundled and hot-loaded from a `data:` URL, which can't resolve bare specifiers (a static `import 'pkg'` fails with *"Failed to resolve module specifier"*, surfaced as a backend error — see [Error handling](#error-handling--module-failures-are-isolated)). The shell preserves `import.meta.url`, so `createRequire` resolves from the module's own `backend.js` upward:

```js
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ws = require('ws')          // a node_modules dep
import { helper } from './lib.js'  // first-party relative imports bundle in — no createRequire
```

The shell never installs module deps for you — the **installer** does (below).

### Sharing modules

Modules are **sharing-first**: a folder ships everything it needs, so installing one is *copy the folder, install its npm deps* — and a git repo of module folders is a **collection**, the one shape atelier shares. The verbs (`atelier package` / `publish` / `add` / `list`), the `atelier` system-needs field, and the full shipping convention are documented on their own page: **[Install](./INSTALL.md)**.

### Runtime state

Backends write persistent state under `ctx.dataDir` (`<module>/data/`). It's per-instance and the shell never touches it — back it up however your platform backs up a folder. Keep `<module>/.claude/` definitional content (skills, commands, hooks) in source; treat `.claude/`'s runtime dirs (`agent-memory/`, `projects/`, …) as local state.

### Skills

`<module>/.claude/skills/<skill-name>/SKILL.md` — the same path Claude Code natively loads when the module directory is the workspace, so for dev just `cd <module> && claude` and the skill is live (no install, no symlink). The shell doesn't read or interpret any of this — `<module>/.claude/` is just part of the module folder and travels with it. How skills get aggregated or installed is a module-space concern, not the shell's.

## Error handling — module failures are isolated

A module's backend runs in **its own process** (see [A process per backend](#a-process-per-backend)), so one module can't take down another, the chrome, or the runtime. Where a failure surfaces depends on *when* it happens — and it's always **per-module** (keyed by `qualifiedId`):

| Failure | What happens |
|---|---|
| **Backend won't load** (import throws — e.g. a node_modules dep loaded with a static `import` instead of `createRequire`) | That module's `/api/<ws>/<id>/*` returns **`500`** with the error + the fix, and a dev **error overlay** shows it. Every other module keeps running. |
| **A request handler throws** | Caught per-request → **`500`** (or `err.statusCode` — `throw` an error carrying a `statusCode`, e.g. a `413`) with `{ error: message }`. Only that one request is affected. |
| **Uncaught async error** — a `setInterval`, an event handler, an unhandled rejection in a background task, *outside* any request | That module's process ends; its lane answers **`500` + overlay** with the error; a fresh process starts with backoff. The shell and every other module stay alive. |
| **A loop, `process.exit()`, out of memory** | The same: that process ends (a loop is killed after 10 s without an answer) and restarts with backoff. |
| **Frontend component throws** (render) | Shown inside the module's own frame; the page, the chrome and other modules are unaffected. |
| **The chrome itself throws** (render — it's the React root) | The shell's boundary catches it: a "Chrome Error" overlay instead of a blank page, the rest of the client stays alive, and editing the chrome **auto-reloads** to recover. |
| **A shell-level fault** (no module in the stack — i.e. atelier's own bug) | The shell **crashes** with a banner naming what it can. That's our bug to fix, not something to hide. |

The `500` + overlay clear automatically once the module loads and runs cleanly again.

**Limits — a process is not a sandbox.** A backend process runs as the same user as the shell and can read what that user can read. The walls between modules on a computer (one sandbox, one data/ each) are a host's, not a laptop's.

**Clean up in `teardown()`** (timers, listeners, child processes — see [Hot reload](#hot-reload-dev)): it's what stops a fixed module's old resources after a hot reload, and what keeps a faulting module from leaking.

## Real-time — `/_atelier/ws`

Atelier exposes **one shared WebSocket per browser tab** at `/_atelier/ws`, multiplexed by **topic**. Topics are qualified ids:

- `'<workspace>/<id>'` — events from one module mount. Same-named modules in different workspaces have distinct topics; they can't cross-talk.
- `'shell'` — shell events (hot reload, etc.); the client always subscribes.

Each frame is JSON `{ topic, ...event }`. The shell stamps `topic` on the way out; the client filters on the way in.

> **Why one WebSocket and not per-module SSE.** Browsers cap HTTP/1.1 to 6 connections per origin; each SSE eats one, so hot-reload + N module SSEs + multiple tabs stalled navigations. A single multiplexed WS per tab is effectively unbounded (Chrome ~255). Same pattern as Vite/Next/Webpack dev-server.

### Server side — `ctx.broadcast(event)`

```js
router.post('/run', async (req, res) => {
  const id = doSomething();
  ctx.broadcast({ type: 'run-started', id });
  ctx.broadcast({ type: 'run-finished', id, ok: true });
  res.json({ ok: true, id });
});
```

The shell **always** stamps the emitted event's `topic` with the module's `qualifiedId` (workspace-aware) — `ctx.broadcast` takes only the payload; a module **cannot** choose or override the topic, so it can only emit under its own identity. (If a module passes a `topic`, it's ignored and the shell logs a dev warning — don't hardcode it.) There is no global `broadcast`.

### Client side — `self.subscribe(handler)`

```js
const self = window.__atelier.self(import.meta.url);
const unsub = self.subscribe((frame) => {        // listens on '<ws>/<id>'
  if (frame.type === 'run-finished') refresh();
});
unsub();   // when no longer interested
```

`self.subscribe(handler)` is `window.__atelier.subscribe(self.topic, handler)` — use the low-level `window.__atelier.subscribe(topic, handler)` directly only to listen on another known topic (e.g. `'shell'`). The shell owns the socket; subscribers across modules and components share it, with auto-reconnect + backoff so dev restarts recover transparently. For initial state on mount (a new subscriber doesn't see prior events), expose an HTTP snapshot endpoint (e.g. `/state`) and call it once, then keep in sync via the subscription.

## Hot reload (dev)

When `hotReload` is on (the default), editing a **`.js`** file under `<module>/` (its `backend.js` or any first-party `.js` it imports) restarts *just that module's* backend process — the shell and other modules untouched (one agent's typo can't crash the others). The shell:

- Runs a native recursive `fs.watch` on the module directory. Watching the dir (not the file) survives atomic saves that change inode, and catches edits to transitive imports (`parser.js`, `lib/*.js`) — not just `backend.js`. Ignores `node_modules/`, `data/`, dotfiles, `_`-prefixed segments; a 150 ms debounce + newest-`.js`-mtime dedupe coalesce duplicate OS events.
- **Bundles** the module with esbuild (`packages: 'external'`, first-party transitive imports baked in, `import.meta.url` preserved) and loads it in a **new process** via a base64 `data:` URL.
- If the load throws, the shell keeps the old process running and logs `reload failed, keeping current version` — and, exactly like an initial load failure, surfaces it **loudly**: the module's `/api/<ws>/<id>/*` returns a `500` carrying the error + fix and a dev error overlay shows it, clearing automatically once a clean reload succeeds (see [Error handling](#error-handling--module-failures-are-isolated)). If it loads cleanly, the old process tears down and exits, then the new one mounts (`↻ reloaded <qualifiedId> backend · pid N`).

Editing the **shell** itself (`server.js`, `build.js`, `discovery.js`, `client.jsx`, `chrome-resolve.js`, `frame.jsx`, `backend-host.js`, `module-json.js`) still needs a manual restart. Set `hotReload: false` (or `ATELIER_HOT_RELOAD=0`) to disable all watchers + backend hot-swap in a deployed instance.

**State resets automatically** — a save is a fresh process, so module-level variables and `ctx.module` slots start empty. **Side effects still want a teardown** — a listening sidecar port, `spawn`ed children: return a cleanup function from `mountRoutes`; it runs before the process exits (on a save, on shutdown):

```js
export default {
  mountRoutes(router, ctx) {
    const watcher = fs.watch(...);
    const timer  = setInterval(...);
    const child  = spawn(...);
    router.get('/things', ...);
    // Runs before this module is swapped out, AND on process exit.
    return () => { watcher.close(); clearInterval(timer); child.kill('SIGTERM'); };
  },
};
```

Rule of thumb: spawns a process, opens a file/socket, or holds a long-lived connection → return a teardown. Pure request handlers on closure state → none needed. (Real-time WS clients are managed by the shell; modules don't clean those up.)

## Cross-module state — `ctx.module(id)`

> **Since each backend is its own process, a slot is per process:** it does not reach another module and does not survive a save. What follows describes the slot within one module's process; for anything between modules, call the other module's API.

`ctx.module(id)` returns a **plain object** keyed by id, inside the calling module's process.

```js
// Most common — stash your OWN long-lived state so it survives hot-reload
// (module-scope vars reset on re-import; a slot persists):
const slot = ctx.module(ctx.id);
slot.watcher ??= fs.watch(/* … */);     // set up once, not on every reload

// Cross-module — a consumer writes the owner's slot; the owner reads it lazily:
ctx.module('search').indexRoot = '/data/corpus';   // from some other module
const root = ctx.module(ctx.id).indexRoot;          // inside the 'search' module
```

- **Read at use time, not mount time.** Modules mount in arbitrary order, so cross-module reads at mount are racy; read on demand and order is irrelevant.
- **Survives hot-reload of either side** — the registry lives on `globalThis.__atelierModuleSlots`, a Map created once per process; a reload swaps `mountRoutes` but the slot keeps its contents (why it's the right home for a watcher / child handle / cache).
- **Workspace is a tenancy boundary** — `ctx.module('search')` in `global/kanban` and in `$alpha/kanban` resolve to different slots; cross-workspace sharing uses persisted records, not the slot.
- **No methods, no validation, no events** — plain data; validation belongs to whoever reads. Owners document the keys they accept in their own source; address a target by its id (`ctx.module('search')`), your own via `ctx.module(ctx.id)`.

## Module conventions

A few rules so modules compose cleanly with the shell and each other:

1. **Don't register process-level signal handlers.** The shell owns `SIGINT`/`SIGTERM`/`'exit'` and calls every module's teardown before exit. A module's own handler can preempt it via `process.exit()` and skip others' cleanups, orphaning children. Kill children in your teardown — that path runs on both hot-swap *and* process exit.
2. **Spawned children must be tracked and torn down** — every `spawn`/`fork`/`execFile` needs a `.kill('SIGTERM')` in the teardown, or it gets reparented to init on Ctrl+C.
3. **Set a "shutting down" flag if your child has restart logic.** SIGTERM is async; a child's `exit` handler fires after teardown returns. Guard respawns:
   ```js
   let shuttingDown = false;
   proc.on('exit', () => { if (shuttingDown) return; setTimeout(restart, backoff); });
   return () => { shuttingDown = true; proc.kill('SIGTERM'); };
   ```
4. **Use `ctx.qualifiedId` (or `self`) for absolute URLs the client follows** — never a literal `/api/<your-name>/...`, which only works under `global`.
5. **Don't edit the shell** (`atelier/server.js` / `client.jsx` / `build.js` / `discovery.js` / `chrome-resolve.js`) from a module task. The shell is cross-cutting; changes there are their own task with their own authorization. If your module needs something the shell doesn't provide, name the gap and ask.

## The frame — a module on its own origin

The instance serves the chrome, which shows every module in a frame on its own origin. An app on its own origin cannot read the page, the sidebar or another app: the page owns the chrome, apps own their pixels.

On a laptop a module's origin is `http://<id>.localhost:<port>` (a workspace module: `<id>.<workspace>.localhost`); browsers send every `*.localhost` name to this machine. The chrome renders the module in its content area; what it receives as `active.element` is an `<iframe>` on that origin. On the module's origin the shell serves that module and nothing of the shell: the frame page, the frame's runtime (React and `/_frame/frame.js`), the chrome's stylesheet built over the chrome's and this module's classes (no other module's) and the chrome's `@atelier/kit`, the module's own files (`/modules/<ws>/<id>/…`), its API (`/api/<ws>/<id>/…`), and a real-time channel carrying only its topic. Anything else there answers 404. Only this instance's page may embed the frame (`Content-Security-Policy: frame-ancestors`). Under a host, a sidebar entry may name a frame origin for a module that runs elsewhere (a remote module): there the shell serves only the frame's part (the page, React, `/_frame/*`, the channel) and the host answers the module's own paths; the frame's stylesheet then holds the chrome's classes only.

**The bridge** — `postMessage`, with the exact origin both ways, carrying this and nothing else:

| the frame gets | the frame gives |
|---|---|
| `init { route, href, title, theme }` when it is ready · `route { route, href }` (back/forward, a deep link) · `theme { theme }` · `dim { on }` (a dialog of the page is open) · ⌘K and Esc pressed inside the frame are handed to the page as if pressed there | `route { route, replace }` · `title { title }` (the module's `document.title`) |

Inside the frame a module has `window.__atelier.self`, `.subscribe` and `.useRoute` (`navigate` updates the page's address through the bridge; in the frame the URL is only replaced, the page owns the history), and, optional, `window.__atelier.deepLink()` — the page's address for the module at its current route. The frame toggles `dark` on its own `<html>` from the page's theme.

What a module cannot do: reach the page (`window.parent.document`, the chrome's DOM, another module's state), or contribute UI to the chrome — a `TopBarCenter` slot or a module marked `meta.eager` does not run in the page. A frame fills the content area to the bottom of the window and scrolls inside.

## What a module gets (ambient)

No shared UI library to import, no build config:

- **React** on `window.React` (UMD) — `const { useState } = React`, inside its frame.
- **Tailwind** classes from whichever chrome is mounted (tokens from the active chrome's `styles.css`); use `className=` freely.
- **Rail icon** named by `meta.icon`, rendered by the active chrome (the shell ships none).
- **`window.__atelier.self(import.meta.url)`** → `{ workspace, id, qid, topic, api, subscribe }`, and **`window.__atelier.subscribe(topic, handler)`** — the WS multiplex. Plus backend `ctx.module(id)` slots and `@atelier/kit`. There is no frontend method-call registry.
- **`window.__atelier.useRoute()`** → `{ path, navigate }` — the module's own URL sub-route (everything after `/<ws>/<id>`). See [Frontend routing](#frontend-routing).

That's it. A module is React + Tailwind + the browser, plus thin WS + routing primitives.

---

## Frontend routing

The shell owns exactly two path segments — `/<workspace>/<id>` — and **everything after them is the module's own space**. A module reads and drives that subpath with one hook:

```jsx
const { path, navigate } = window.__atelier.useRoute();
//  path                       → subpath after /<ws>/<id>, no leading slash
//                               '' at the module root; e.g. on /vault/drive/a/b → 'a/b'
//  navigate('a/b')            → pushState  /vault/drive/a/b
//  navigate('a/b', {replace:true})
//  navigate('')               → back to the module root /vault/drive
```

Back/forward, deep-links, and your own `navigate()` calls **all re-render the module with the new `path`** — there are no `history.*` calls, no `hashchange` listeners, and no event-suppression to get right. The URL is the single source of truth; mirror it into render and you're done:

```jsx
export default function Module() {
  const { path, navigate } = window.__atelier.useRoute();
  if (!path) return <Index onOpen={(id) => navigate(`item/${id}`)} />;
  const [, id] = path.split('/');               // 'item/<id>'
  return <Detail id={id} onClose={() => navigate('')} />;
}
```

What you can rely on:

- **`path` is free-form.** The shell never parses or validates it — `a/b/c`, `item/42`, `settings`, whatever your module means. Slash-separated is just a convention you choose.
- **Deep-links and refresh work.** Loading `/<ws>/<id>/a/b` directly serves the SPA and your module mounts with `path === 'a/b'`.
- **No remount on sub-nav.** A subpath change re-renders the module in place (same `ws`+`id` → stable identity), so component state, effects, and **WebSocket subscriptions survive** — `self.subscribe`'s topic is your qid, never the route. Switching module or workspace (a different `ws`/`id`) remounts as usual and resets the subpath.
- **The shell owns `/<ws>/<id>`.** A module routes *within* its own subtree; it can't claim a top-level path or another module's space. To send the user to a different module, that's a chrome affordance (the rail / `navigate(qid)` the chrome receives), not `useRoute`.

`useRoute` is opt-in: a module that keeps its sub-view state in memory and never touches the URL is perfectly fine. `location.hash` and `?query` still work too — but `useRoute` is the supported way to get deep-linkable, back/forward-correct sub-views.

---

## Sidecar servers

Some modules need a **second HTTP server on their own port** — a public surface the shell's request lane can't serve. For example, a module that publishes pages might run a dedicated `http.createServer` to serve them at `/p/<id>/…` — arbitrary path depth, its own auth, public visitors — none of which fits the shell's scoped, no-wildcard `/api/<ws>/<id>` router.

Reach for a sidecar when you need one of:

- **URL shapes the module router won't match** — wildcards, deep/arbitrary paths, a bare `/`. The shell router is exact-prefix under `/api/<ws>/<id>`, no wildcards.
- **A surface outside the shell's auth** — something an unauthenticated visitor or another service hits directly, with the module enforcing its own scheme.
- **Its own CORS, content types, or protocol**, independent of the shell.

If you only need module API routes, use the `mountRoutes` router — not a sidecar.

### The shell's role is small

A sidecar is **plain Node `http`** — there's no "sidecar API." What the shell gives you, via `ctx` / env:

- **`ctx.baseUrl`** (and `process.env.BASE_URL`) — the instance's external URL, so the sidecar and anything it spawns build correct links.
- **`ctx.log(msg)`** — log through the shell.
- **`ctx.broadcast(event)`** — push onto the module's own WS topic from inside the sidecar.
- **Teardown on shutdown** — the shell fires every module's teardown on `SIGINT` / `SIGTERM` / exit, so your sidecar (and any child process) is closed, not orphaned.

The shell does **not** allocate the port, proxy to it, gate it, or expose it. Those are yours (and the operator's).

### Lifecycle — start in `mountRoutes`, close in teardown

A sidecar is a long-lived listener, so it lives by the [hot-reload teardown contract](#hot-reload-dev): `mountRoutes` re-runs on every reload, so you **must** close the old server or the next reload hits `EADDRINUSE`.

```js
import http from 'node:http'
const PORT = Number(process.env.MYMOD_PORT || 7400)

export default {
  async mountRoutes(router, ctx) {
    // ... your /api routes on `router` ...

    const server = http.createServer((req, res) => { /* raw URL routing */ })
    server.on('error', (e) => {                       // never crash the shell
      if (e.code === 'EADDRINUSE') ctx.log(`mymod · port ${PORT} in use — sidecar not started`)
    })
    server.listen(PORT, '127.0.0.1', () => ctx.log(`mymod · sidecar on http://127.0.0.1:${PORT}`))

    return () => { try { server.close() } catch {} }   // ← closes on reload AND on shutdown
  },
}
```

### Exposure & auth — you own both

A sidecar sits **outside** the shell's three pillars (frontend rail / HTTP presence / WS ACL — see [Auth](./AUTH.md)). `authenticate` and `authorize` never run for it. So:

- **Bind to `127.0.0.1`**, not `0.0.0.0`. Let the **operator's reverse proxy / tunnel** (nginx, a tunnel, …) map a public hostname to the port — the shell doesn't proxy to it.
- **Enforce your own auth** on anything non-public. The shell can't help — a sidecar that needs to know who's calling must carry its own scheme (e.g. signed per-resource tokens in the path). Treat it like any service you put on the internet.
- **Pick the port from a module-specific env var** with a sensible default (`MYMOD_PORT`), and document it. Avoiding collisions across the shell port and other sidecars is the operator's job.

### Optional patterns — examples, not rules

Atelier has no opinion past the points above. These are common ways to solve recurring sidecar problems — borrow or ignore freely; none is part of the contract.

- **For a *public* sidecar, consider a separate child process (a suggestion, for security).** A sidecar can run in-process (a plain `http.createServer` in the module's own process) or as a spawned child process (tracked + torn down per the [hot-reload rules](#hot-reload-dev)). For a surface facing the open internet the **child-process** shape is safer: a crash or compromise on the public listener can't reach the shell's process, other modules' in-memory state, or their file handles. The cost is IPC (a port, or files as the channel) instead of shared closure state — weigh isolation vs. simplicity per surface.

- **A `200` from a public URL doesn't prove *your* instance served it.** When a tunnel/proxy can point a hostname at more than one machine (e.g. mid-migration), another machine can answer the same name. If that matters, have the sidecar stamp a per-process marker on its responses and compare the public URL against `127.0.0.1:<port>` — equal ⇒ this instance is the live origin. That's just an ordinary thing you can do on a plain `http` sidecar; pick your own header or approach. **Not** an atelier feature or requirement.

---

## Special module: the chrome

The shell ships **zero visual bytes** — no rail, topbar, fonts, colors, favicon, or icon set. All of it lives in a **chrome**: a global-workspace module that exports `meta = { isChrome: true, hidden: true }` and a `chrome(props)` function the shell renders as the root. The shell itself ships none; the instance's **default** chrome is the one named by `atelier.config.json`'s `defaultChrome` setting, otherwise the first global module with `meta.isChrome === true` (alphabetical by qualifiedId). With no chrome installed at all, the client renders a plain "add a chrome" screen. An instance can also mount several chromes and let individual modules choose one — see [Per-module chrome](#per-module-chrome--metachrome).

A chrome is something you **install or write** — nothing ships with the shell. To make one, create a global-workspace module with `meta = { isChrome: true, hidden: true }` and a `chrome(props)` export, then point your config at it:

```json
{ "defaultChrome": "~/my-chrome", "modules": ["~/my-chrome"] }
```

The shell calls `chrome(props)` with:

| prop | what it is |
|---|---|
| `boot` | `{ mode, label, … }` — `mode` is `'host'` (a normal instance) or `'standalone'` (a single module via `dev:module`); `label` is the optional instance name from config, or `null`. Also carries `chromeQid` (the chrome resolved for this document), `defaultChromeQid`, `chromes` (the available chrome qids), and `backendErrors` (`[{ qid, message }]` for modules whose backend failed to mount) |
| `user` | the post-auth user (`{ id, name, workspaces }`) |
| `modules` | `[{ qid, id, workspace, hasFrontend, meta }]` — everything mounted |
| `workspaces` | `[{ id, name?, modules: [{ id, meta }] }]` |
| `workspace` | the currently-routed workspace id |
| `activeQid` | the active module's qualifiedId, or `null` |
| `active` | `{ kind: 'none' \| 'error' \| 'ready', element?, err?, qid?, title? }` — what to put in the content area. For a module, `element` is its frame; `title` is what the frame gave as its title, or `null` |
| `loadedModules` | `{}` — modules run in their frames, the page imports none of them (kept so a chrome that reads it keeps working) |
| `navigate(qid)` | SPA-navigate to a module |
| `pickWorkspace(wsId)` | switch workspace |

The chrome renders `active.element` as the page body and draws the rail/nav from `modules` + `workspaces`. It owns everything visual; the shell hands it state and waits.

### A chrome can bring real dependencies

The shell detects chrome modules at request time and routes their `frontend.jsx` through full esbuild **bundling** (`react`/`react-dom`/`react/jsx-runtime` aliased to `atelier/shims/*` so the chrome shares the shell's React instance). So a chrome can ship its own `node_modules/` and use bare specifiers:

```jsx
// my-chrome/frontend.jsx
import * as Headless from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

export const meta = { isChrome: true, hidden: true }
export function chrome({ modules, active, navigate, ... }) { return <div>{/* … */}</div> }
```

Drop a `package.json`, `npm install`, and the shell bundles it. Size is uncapped (a chrome built on a component library + icon set can be a few MB; cached after first build). The chrome injects its own icon set and `styles.css` (`<link>` at load) — the shell defines no tokens.

**Stylesheet preload (avoid a flash of unstyled content).** When the active chrome has a `styles.css`, the shell injects a render-blocking link into `<head>` *before* your bundle parses, so the first paint is styled:

```html
<link id="atelier-chrome-styles" rel="stylesheet" href="/modules/<chromeQid>/styles.css">
```

If your chrome *also* injects its stylesheet at runtime, **reuse the same id `atelier-chrome-styles`** and skip when it already exists — otherwise you add a duplicate `<link>`:

```js
if (!document.getElementById('atelier-chrome-styles')) {
  // … create your <link id="atelier-chrome-styles" rel="stylesheet" href={new URL('./styles.css', import.meta.url)}> …
}
```

### The bundle path — what changes when code is bundled

A chrome is **bundled** by esbuild; a module's `frontend.jsx` is **transformed per file**. Bundling is what enables real npm dependencies — and it changes a few things worth knowing. These are properties of the **bundle path, not of "chrome"** as a concept; anything atelier bundled would behave the same.

- **`import './x.css'` is a build error.** CSS isn't bundled — ship styles through your `styles.css` (the render-blocking `<link>` above), never a JS `import`. Importing CSS from JS **fails the bundle loudly** with that message (you'll see it on the bundle / a broken render), rather than silently doing nothing. (This is the one bundler habit from Vite/Next that doesn't carry over.)
- **`.js` files are parsed as JSX.** You can write `<Foo/>` in a plain `.js` file and split components across `.js`/`.jsx` freely — no extension ceremony.
- **`process.env.NODE_ENV` follows the `env` setting; `process.env` is `{}`.** This has nothing to do with chrome — it's because the bundle includes **third-party npm** code written for Node. Libraries gate dev warnings behind `process.env.NODE_ENV !== 'production'` and read `process.env`; in the browser there's no `process` global, so esbuild defines `NODE_ENV` (to your [`env`](./README.md#settings) setting — `development` by default, so library dev warnings show; `production` strips them) and `process.env` to `{}` (any other `process.env.X` read becomes `undefined` instead of a `ReferenceError`). Consequence: you can't read environment variables from bundled frontend code — pass config in via props or a fetch.
- **JSX uses the automatic runtime — no `import React` needed.** In the bundle, `<Foo/>` compiles to `react/jsx-runtime` (auto-imported). A *module* `frontend.jsx`, by contrast, uses the classic transform (`React.createElement`) against the **global** `React` and must **not** `import React`. Copying a component between the two contexts flips this — the mismatch surfaces as `React is not defined` or a duplicate React.

### Publishing primitives — `@atelier/kit`

A chrome can ship a `kit.js` (or `kit.jsx`) beside its `frontend.jsx`. When the shell sees it, it injects an import map per request:

```html
<script type="importmap">{"imports": {"@atelier/kit": "/modules/<chromeQid>/kit.js"}}</script>
```

Companion modules then write plain ESM imports — `import { Button, Dialog, Input, Field } from '@atelier/kit'` — and the browser resolves them to the active chrome's bundled kit. No bundling on the module side, no runtime registry, no `window.__atelier.kit` global — the kit is a real ES module file you can Cmd-click into.

A chrome's `kit.js` is a barrel re-export; **what to publish is chrome-defined**, and there's no enforced contract. A module importing `Foo` from `@atelier/kit` is implicitly paired with whichever chrome exports a compatible `Foo` — swap chromes and modules either get re-themed (same names, compatible props) or break. **Themes are not drop-in by design**: co-design a chrome with its companion modules. (A kit typically barrels primitives like `Button`, `Dialog`, `Field`, `Table`, etc.)

### Per-module chrome — `meta.chrome`

An instance can run **more than one chrome at once** — each module renders inside the chrome it asks for. By default every module uses the instance's default chrome; a module opts into a different one by naming it:

```js
// reports/frontend.jsx
export const meta = { name: 'Reports', icon: 'chart-bar', chrome: 'midnight-chrome' }
export default function Module() { /* … renders inside the 'midnight-chrome' chrome … */ }
```

`meta.chrome` is a **chrome id** — the chrome module's folder name. Resolution:

- **`meta.chrome` names a mounted chrome** → that chrome (its rail, layout, fonts, and `@atelier/kit`).
- **No `meta.chrome`** → the instance **default** chrome.
- **`meta.chrome` names a chrome that isn't installed** → a clear **"chrome not installed" error** (the server warns; the page renders the error inside the default chrome as a host frame, with the rail still usable so you can navigate away). **There is no silent fallback** — a module that asks for a chrome it can't get fails loudly, instead of rendering mis-themed or crashing later on a missing `@atelier/kit` export.

> **Recommended: set `meta.chrome` on any module that imports `@atelier/kit`** — i.e. effectively every UI module. A module's kit imports are chrome-specific, so it's *already* bound to a chrome; `meta.chrome` makes that binding explicit and turns "the chrome isn't here" into an actionable error at the right moment. Leave `meta.chrome` off only for chrome-agnostic modules that import no kit primitives (those genuinely run under any chrome).

**Default vs. available — both come from discovery; no new config keys:**

| | how it's set |
|---|---|
| **Available chromes** | every *mounted* module with `meta.isChrome === true`. Mount one (in the instance folder, a `modules` path-mount, or a collection install) and it's selectable; deny it in `atelier.config.json` and it isn't. |
| **Default chrome** | the `defaultChrome` setting (or `ATELIER_DEFAULT_CHROME` env), else the alphabetically-first mounted chrome. |

**Navigation crosses chromes with a full page load.** A chrome can't be swapped inside a live document — its `styles.css` and the `@atelier/kit` import map are baked in when the page loads. So navigating from a module on chrome A to one on chrome B triggers a full reload (the new document boots in B); navigating *within* a single chrome stays a client-side SPA transition. **With no `meta.chrome` anywhere, every module resolves to the default and nothing ever reloads — behaviour is byte-identical to a single-chrome instance.** For the smoothest feel, pin chromes at the app/workspace granularity, so a reload happens only when you switch apps, not on every click.

**This is what makes a shared collection work.** An app can ship its **own chrome folder** alongside its module(s) and pin it with `meta.chrome`. Installing the app mounts both: the module themes itself with its chrome. On an instance that *doesn't* have that chrome, the module shows the clear "chrome not installed" error above — so the operator knows exactly what to mount, rather than the app silently rendering in the wrong skin.

> **Kit pairing.** A themed module's `@atelier/kit` resolves to *its* chrome's kit — so pair a module with a chrome that exports the primitives it imports. Themes aren't drop-in (see [`@atelier/kit`](#publishing-primitives--atelierkit) above).

## Special module: auth

The other special module is the one named in the `auth` setting — it gates every request, owns identity/sessions, and produces the `user` object (which drives the rail, the API/WS access boundary, and login). It's the single trusted layer between the shell and the modules. See **[AUTH.md](./AUTH.md)** for the full contract (`authenticate` / `authorize` / `handleUnauth`, the `user` shape, and the three pillars of enforcement).
