# Atelier

The app shell + module runner. Discovers sibling modules, mounts their backends, serves their frontends, and renders whatever **chrome** (theme) you install around them — one runtime hosting many small modules.

## Why atelier is shaped this way

Atelier is a **harness for building apps fast — especially with coding agents.** Its shape is deliberate: it fixes the things that are hard to get right *across* an app, so each app you build can stay small, self-contained, and safe. It is a separation of concerns into three layers, frozen-to-flexible:

- **The shell is the fixed baseline.** It owns the cross-cutting machinery — the build step, routing, the real-time WebSocket, hot reload, workspaces, auth, and the module boundary. These are *frozen*: you build **on** them, you never rebuild them, and because they don't move you can trust them.
- **The chrome owns visual coherence.** One theme wraps every app, so dozens of independently-built apps look like one product — and no single app can reach in and restyle the whole system. Visuals are the chrome's job, not each app's.
- **A module is just your feature** — a `frontend.jsx` and/or a `backend.js`. No build to configure, no dependencies to vendor, no design system to invent. Thin by design.

**The constraints are the point.** By freezing the baseline and the visuals, every app stays **small enough to fit in one context window** — small enough that an agent (or a person) can hold the whole thing in its head, hammer out the feature, and never touch the parts that would break everything else. The things you *can't* easily do here — bring your own React, router, or bundler, or restyle the shell — are exactly the things that would make an app large, inconsistent, or unsafe. What looks like a limitation is a paved path: it removes the setup, dependency, and consistency work that derails a build, and leaves you writing the one thing that matters — the feature.

The payoff: **many small, independent codebases compose into one large, coherent, multi-tenant system.** Each module is a context-window-sized unit of work; the shell and the chrome are what let dozens of them add up to something far bigger than any one of them — sharing one runtime, one React instance, one visual language, and one trust boundary.

## What each layer can and can't do

The split above is enforced by *how each layer is built and loaded* — so the mechanism tells you exactly what's possible, and keeps you from fighting the harness.

**The shell** — the frozen core (`server.js`, `build.js`, `discovery.js`, `client.jsx`, `chrome-resolve.js`).
- *Owns:* discovery, routing (`/<ws>/<id>`), the build pipeline, the single WebSocket multiplex, hot reload, workspaces, the auth slot + module boundary, and the `window.__atelier` / `ctx` surface.
- *A module can't touch it* — no adding middleware, changing routing, opening a second socket, or widening `ctx`. **Why good:** the contract every module depends on stays stable and trustworthy; changing the core is a deliberate edit, never a side effect of a feature.

**The chrome** — visuals (one global module, `meta.isChrome`).
- *Can:* ship a real component library + icon set — it's **fully bundled** by esbuild with its own `node_modules` and bare-specifier imports — publish primitives via `@atelier/kit`, and own the rail / topbar / fonts / colors / tokens / `styles.css`.
- *A module can't restyle the shell or override the chrome* — it renders *inside* its assigned chrome and borrows the chrome's kit + tokens. **Why good:** dozens of independently-built apps stay visually coherent, and no one app can break the look of the whole.

**A module frontend** (`frontend.jsx`) — transformed **per-file** (not bundled), sharing the shell's single React via a global.
- *Can:* be a React component with hooks, subscribe to its own real-time topic (`self().subscribe`), deep-route within its subpath (`useRoute`), and import sibling files + `@atelier/kit`.
- *Can't `import` an npm package or icon library, and must not `import React`* — only `react` / `react-dom` / `@atelier/kit` resolve, and JSX compiles to the global `React.createElement`. **Why good:** zero per-module build + instant hot-reload, and one React instance — so hooks, context, and the live channel work *across* the module/shell/chrome boundary instead of fracturing into N Reacts.

**A module backend** (`backend.js`) — bundled with dependencies kept **external**, hot-loaded from a `data:` URL.
- *Can:* mount scoped routes under `/api/<ws>/<id>`, `ctx.broadcast`, persist under `ctx.dataDir`, keep long-lived state across reloads via `ctx.module`, and import sibling files.
- *Can't statically `import pkg from 'pkg'` for a node_modules dependency* — a `data:` URL has no path to resolve bare specifiers from; load them with `createRequire(import.meta.url)('pkg')`. **Why good:** the whole backend hot-swaps atomically with no process restart — edit a handler and it's live.

**Across all of them, the shell owns the tenant gate.** Which users reach which workspaces is enforced from `user.workspaces` — never from a module's self-declared `meta` — and a module can't exempt its routes or topics from the gate. **Why good:** a sloppy or vibe-coded module can't *accidentally* serve one tenant's data to another, because auth was never its job. The flip side is stated just as plainly: module **code** is trusted like any dependency — a backend runs in the shell's process and can open sidecars or touch the disk — so install modules the way you install packages: from authors you trust.

> **Platform.** Atelier runs anywhere **Node 24+** does — there's no OS-specific install layer (an instance is a folder you run; your process manager / PaaS / reverse proxy is your concern). Recursive file-watching (hot reload) works on macOS, Linux, and Windows on Node 24.

**The rest of the docs:**
- **[Install](./INSTALL.md)** — creating an instance (`npm create`), collections (the one shareable shape) and the verbs that move them (`atelier package` / `publish` / `add` / `list`), and the shipping convention.
- **[Modules](./MODULES.md)** — building a module (shape, `ctx`, real-time, hot-reload, slots), plus the special modules: the **chrome** and a pointer to auth.
- **[Workspaces](./WORKSPACES.md)** — the multi-tenant model: `global` + `$<ws>/`, the `qualifiedId`, the rail and picker.
- **[Auth](./AUTH.md)** — the trusted auth slot: `authenticate` / `authorize`, the `user` object, request gating across all three surfaces.
- **[Recipes](./RECIPES.md)** — proven shapes for common module-authoring situations: links that work from wherever the reader is, live data without polling, sidecars that follow the instance's exposure, frontends reaching a sidecar port.

This page is the shell itself: running an instance, what lives in `atelier/`, and configuration.

## Running an instance

An atelier instance is a **folder you run** — no launchd, no `~/.atelier/`. The folder holds (or path-mounts via config) your modules and a chrome, plus an optional `atelier.config.json`. The shell itself can live in either of two places:

**As a dependency** — `npm install @pa1nd/atelier`, or scaffold a fresh instance with `npm create @pa1nd/atelier my-studio` — optionally pulling a whole **starter collection** of modules (chrome included) with `-- --kit <collection>`; scaffolder options are documented at [create-atelier](https://github.com/pA1nD/create-atelier). The shell runs itself from `node_modules` via its `atelier` bin:

```
npx atelier                                # http://localhost:1844 (PORT= to override), hot reload
npx atelier <id>                           # standalone — just one module
npx atelier <workspace>/<id>               # standalone — a workspace module
npx atelier help                           # the usage, one line per verb; a word that is no verb and no module folder here prints it, exit 2
```

**As a subfolder** — a checkout of this repo at `<instance>/atelier/`:

```
npm install
npm run dev                                # http://localhost:1844 (PORT= to override), hot reload
npm run dev:module -- <id>                 # standalone — just one module
npm run dev:module -- <workspace>/<id>     # standalone — a workspace module
```

Either way it's the same server (`npm run dev` and the `atelier` bin are both just `server.js`). Install modules into the instance with **`npx atelier add <source>`** — collections and the sharing verbs are documented in [Install](./INSTALL.md). Point a browser at the port; you'll see an "add a chrome" screen until a chrome is installed (the shell ships none). Standalone mode runs a single module in isolation — it shows no chrome unless the requested module is itself one.

> **Which folder is the instance?** Resolved in priority order: **1.** `ATELIER_ROOT=/path/to/instance` — explicit; for **managed launchers** (launchd, systemd, Docker, a PaaS) that may not set `PWD`, and for monorepos whose hoisting puts the shell in the repo-root `node_modules`. **2.** Shell installed as a dependency — the instance is the folder that *owns* the `node_modules` the shell runs from (a pnpm nested store resolves to the consumer project, not the store). **3.** Subfolder layout — the parent of the folder you run from, inferred from `PWD` (your shell's logical working directory — so it still points at the instance even when `atelier/` is a shared symlink). The resolved root is printed at startup (`Atelier · <mode> · <root> · env=<env>`), so a wrong one is obvious.

### One folder = one instance

There is no dev/prod mode. To run a second instance — a "production" one, staging, a per-tenant one — **run a second folder** (or the same folder with different startup settings). Each instance's behavior is resolved from three layers, lowest to highest:

1. **System defaults** — `port: 1844`, `hotReload: true`, `auth: false`, no chrome.
2. **`atelier.config.json`** in the instance folder — the source of truth (see [Configuration](#configuration--discovery)).
3. **Environment variables** at startup — they override the file, so a PaaS can inject a dynamic `PORT` / `HOST` / `BASE_URL`.

A typical "production" folder sets something like `{ "hotReload": false, "auth": "<auth-module>", "defaultChrome": "<chrome>", "port": 1844 }` and sits behind your own reverse proxy. atelier doesn't manage processes, TLS, or hostnames — that's your platform's job.

## What lives in `atelier/`

- `server.js` — runner, router, discovery, settings resolution (defaults ← config ← env), WebSocket multiplex (`/_atelier/ws`), hot-reload broadcaster, the auth slot, chrome-slot resolution.
- `build.js` — build pipeline (esbuild JSX + Tailwind v4 + oxide).
- `backend-procs.js` — the shell's side of a process per backend: starts, reloads and stops each module's process, restarts one that crashed or looped, and forwards the module's `/api/<ws>/<id>/…` lane to it.
- `backend-host.js` — the process each module's backend runs in: mounts it with the scoped router and `ctx`, listens on a private socket the shell forwards to.
- `frames.js` — every module on its own origin: the frame document, the frame's runtime and the chrome's stylesheet and kit for it, the module's own files and API, and a real-time channel carrying only its topic.
- `frame.jsx` — the module's side of its frame, served on the module's own origin at `/_frame/frame.js`: `self`, `subscribe`, `useRoute`, the bridge.
- `module-frame.jsx` — the page's side of a module's frame: the iframe and its bridge (route, title, theme, keys, dim).
- `user-modules.js` — the person's modules as the page holds them: each with its qid in the workspace that lists it and where its frame is, its origin and its own qid there.
- `hosted.js` — the host switch (`hosted`): loads the host's file, and answers who the person is, the sidebar, the caller, nobody signed in, and the host's pages.
- `host-pages.jsx` — the host's pages in the page: its sidebar entries per workspace, the page and the workspace an address names, a page in the chrome's content area, and the sign-in page.
- `module-json.js` — reads a module's `module.json`, and the shell's read of it beside a frontend's `meta`.
- `router.js` — the router a module's backend is given, the same in the shell, in a backend's own process and in a computer's serving sandbox: scoped paths, `:params`, `req.json()`, `res.json()`.
- `ws-bridge.js` — the real-time channel of the page and of a frame: one WebSocket per tab to its own origin's `/_atelier/ws`, many topics, `self` and `subscribe`.
- `limits.js` — every wait, size and count the CLI, the backend processes and `module-serve.js` hold to, each named once with what it bounds.
- `module-serve.js` — one module, headless: the process a host's computer runs for a module in a serving sandbox, answering its API, its frontend and its declared tools on one unix socket.
- `session.js` — the CLI's session with a host: the credentials file, the call to the host, and the sentence every verb says for each kind of answer.
- `args.js` — a verb's arguments: its options declared as data, read by one loop, its help rendered from the same data.
- `repo.js` — the module folder's repository: the git remote that says where an app lives, `<host>/git/<computer>/<module>.git`, and the app's label.
- `ops.js` — the client of the maintain verbs: an op asked of the host (inside a sandbox, of the computer's socket), its lines and output streamed back, one exit convention, and the readers data and files share (a file's pieces, its sha256).
- `sandbox.js` — inside a sandbox: the computer's socket, the one way out, which `push`, `clone` and the maintain verbs use in place of a session.
- `login.js` — `atelier login`: signs in to a host by approving a code in the browser, and keeps the session for that host.
- `login-screen.js` — the screen `atelier login` draws while it waits: the title, the scene, the link with the code, the code.
- `whoami.js` — `atelier whoami`: who this machine acts as, on which host, with `--grants` and `--sessions`.
- `logout.js` — `atelier logout`: ends the session on the host and forgets it here.
- `computers.js` — `atelier computers`: the computers you hold a grant on.
- `create.js` — `atelier create`: a module folder with its repository, its remote `atelier` set to your own computer.
- `remote.js` — `atelier remote`: points this module at a computer you may maintain, `--name` for a second environment.
- `clone.js` — `atelier clone`: an app's code from the host's git, never its data, with its remote set.
- `push.js` — `atelier push`: a git push that makes the app live, its answer printed as `remote:` lines.
- `releases.js` — `atelier releases`: what was live and when, from the host's record.
- `logs.js` — `atelier logs`: the app's log, followed with `-f`.
- `ps.js` — `atelier ps`: the live commit, awake or resting since when, the last request.
- `restart.js` — `atelier restart`: the app stopped and started from the same commit.
- `run.js` — `atelier run`: a command beside the live app, in its code, with its `data/` and config, and a terminal of its own when run from one.
- `config.js` — `atelier config`: the app's settings and secrets, their values never shown.
- `data.js` — `atelier data pull | push`: the live `data/` down into this folder, or this folder's up.
- `files.js` — `atelier files push | pull | sync`: a folder to and from a computer's drive, only what differs moving.
- `agent.js` — `atelier agent`, `agent new`, `agent primary`: the agents of a workspace.
- `attach.js` — `atelier attach`: a terminal into a workspace's shell, through the host.
- `agent-attach.js` — `atelier agent attach`: your terminal in front of an agent's live session.
- `attach-client.js` — the one client of both attaches: the screen as the host streams it, the keys, the scrollback, the way out.
- `modules-git.js` — `atelier add` and `atelier update` for a module that is a git repository: cloned into the instance, pulled forward.
- `discovery.js` — discovery rules (reserved names, workspaces) + `atelier.config.json` parsing.
- `index.html` — template; React + ReactDOM UMD. A single inline rule resets margins and hints `color-scheme`; the shell paints zero pixels (no favicon, theme-color, or icon library — those belong to the chrome).
- `client.jsx` — slim router + bundle loader + error fallback. Loads the chrome bundle (`chromeQid` resolved server-side) and renders it as the root; wires the WS multiplex + `window.__atelier.self` / `.subscribe`.
- `chrome-resolve.js` — the *one* implementation of "which chrome does a module render in?" (`meta.chrome` → default). Imported by `server.js` (Node), by `client.jsx` (browser, served at `/assets/chrome-resolve.js`), and by the tests — so the document's chrome and the client's SPA-vs-reload decision can't drift.

**Shell files are pinned to the running process.** Unlike modules (which hot-reload), `server.js`, `build.js`, `discovery.js`, `client.jsx`, and `chrome-resolve.js` only take effect on an **explicit restart**. The shell's served bytes — the `/assets/client.js` bundle and the `index.html` template — are built/read **once at process start** and held for the process lifetime, so the running server and what it ships to the browser always match; editing a shell file can never half-apply (a freshly-recompiled client against a stale server). This is deliberate: a change to the cross-cutting core should be a conscious restart, not a silent live-swap. (Module and chrome bundles under `/modules/*` are *not* pinned — they hot-reload, which is the point of a module.)

The shell defines **no design tokens** — they live in the active chrome's `styles.css`, injected via `<link>` at load. Chromes are ordinary (hidden, global) modules you install or write — **none ships with the shell**. How to write one is in [Modules → the chrome](./MODULES.md#special-module-the-chrome).

## Configuration & discovery

### Selecting which modules are enabled — `atelier.config.json`

Optional, and the instance's source of truth. Without it, every discovered module runs with system defaults. With it, you set instance **settings** and **filter** which modules run. Drop it at the instance root (next to `atelier/`):

```json
{
  "label": "studio",
  "port": 1844,
  "defaultChrome": "~/chromes/my-chrome",
  "hotReload": true,
  "auth": false,
  "modules": ["kanban", "polish", { "workspace": "bigcorp", "modules": ["!wip"] }]
}
```

#### Settings

All optional; resolved **defaults ← config ← environment** (env wins, so a PaaS can inject a dynamic port):

| Key | Default | Env | Meaning |
|---|---|---|---|
| `port` | `1844` | `PORT` | listen port |
| `host` | `127.0.0.1` | `HOST` | interface to bind. The default keeps the instance reachable only from this machine; `0.0.0.0` (all IPv4) or `::` (+ IPv6) exposes it to the network the machine is on — startup then lists the reachable addresses; a specific address (a LAN or VPN IP) binds just that interface. Expose only on a network you trust or behind an auth-terminating proxy — see the [pre-1.0 recommendation in Auth](./AUTH.md) |
| `baseUrl` | `http://localhost:<port>` | `BASE_URL` | external URL modules build links from |
| `env` | `development` | `NODE_ENV` | frontend build mode — `development` (default, like an unset `NODE_ENV`) ships React + bundled-library dev warnings, unminified, with an inline sourcemap; `production` minifies the chrome bundle (dropping the inline sourcemap), strips bundled-library dev branches via the `process.env.NODE_ENV` define, and serves the minified React UMD. Independent of `hotReload`. |
| `defaultChrome` | _(election)_ | `ATELIER_DEFAULT_CHROME` | path/id of the **default** chrome module; overrides alphabetical election among installed chromes. A module can pin a different installed chrome with `meta.chrome` ([Per-module chrome](./MODULES.md#per-module-chrome--metachrome)) |
| `hotReload` | `true` | `ATELIER_HOT_RELOAD` | file watchers + backend hot-swap; set `false` when deployed. Off, the files are taken as unchanging while the process runs, so every built asset is addressed by a tag of its sources (`?v=<tag>` in the document, the import map and every relative import) and kept by the browser (`immutable`); on, every asset revalidates (`no-cache` + ETag) so an edit shows at once |
| `observe` | `false` | `ATELIER_OBSERVE` | request observability, for debugging a live instance: tracks in-flight requests, serves `GET /_atelier/inflight` (auth-gated; includes `total`, a requests-since-boot counter), and logs slow/abandoned/long-unanswered requests to `~/Library/Logs/atelier-requests.log` where that folder exists. Observe-only — enforces nothing; off = none of it runs |
| `auth` | `false` | `ATELIER_AUTH` | path/id of the auth module, or `false` to run ungated (see [AUTH.md](./AUTH.md)) |
| `revalidateMs` | `30000` | `ATELIER_REVALIDATE_MS` | how often live WebSocket sockets re-run `authenticate` (only when `auth` is set) — so logout/permission changes propagate without a reconnect; see [AUTH.md](./AUTH.md) |
| `label` | `null` | `ATELIER_LABEL` | optional instance name a chrome may display |
| `frameDomain` | `localhost` | `ATELIER_FRAME_DOMAIN` | the parent name of the modules' own origins. Each module is framed on `http://<id>.localhost:<port>` (a workspace module: `<id>.<workspace>.localhost`); on a machine reached by name, set it and point a wildcard name at the instance: `<id>.<frameDomain>`, scheme and port from `baseUrl`. See [the frame](./MODULES.md#the-frame--a-module-on-its-own-origin) |
| `hosted` | _(none)_ | `ATELIER_HOSTED` | **the host switch**: a JS file, for a host that runs this shell behind itself. With it, the shell trusts the `X-Atelier-Caller` header the host sets after verifying the caller (base64url JSON; it becomes `ctx.caller`). The file may export `person(req)` → `{ person, name }` or nothing — *who the person is*, in place of the `auth` module; nothing answers `401` — and `sidebar(req, person)` → `[{ id, name, icon, origin, workspace? }]` — *where the sidebar comes from*, in place of the modules found in the folder (`origin` is where that module's frame lives: an entry with an origin may be listed in any workspace, and in several, an entry in each; its frame lives at its origin's global address, `<origin>/<global>/<id>`, the app alone in the global workspace there, while the page's address and the routes its frame reports stay the workspace's that lists it; an entry `{ workspace, name? }` with no `id` declares that workspace, listed with no modules). `person()` may add `logout`, an address on this origin the chrome's Sign out posts to (it is not part of `ctx.caller`). And `pages` — *the host's own pages*, which are not modules and never frames: `{ '/path': { title, file, icon?, sidebar?, workspaces?, admin? }, …, signIn: { title, file } }`; `admin: true` is handed to the browser with the page, for the host's pages to show it to a workspace's admins alone. Each page is also a sidebar entry of every workspace that lists it (every one, or with `workspaces: 'global'` the global one alone, with `'others'` every other one), in the host's order and before the modules (handed to the chrome among `modules`, and among that workspace's `modules` in `workspaces`, so a workspace with pages and no module is in the picker, as a primary item of the workspace, its `qid` `<ws>/<path without its leading slash>`, Home's `<ws>/`, so the chrome links it to its address; `icon` a lucide name, `file` by default), unless it says `sidebar: false`; so the way back to the host's Home never leaves the sidebar. A page is a React component, its file's default export, written like a module frontend (JSX transformed per file, React from the page, `@atelier/kit` from the chrome; files in one folder, served to anyone at `/_atelier/pages/<name>.js`, scanned for the chrome's classes; the document of a page's address names that page and its static imports up front, then every other page's, `<link rel="modulepreload">`, as it names the shell's own and the chrome's bundle, so the browser fetches them in one wave and a tab clicked later finds its code kept). A page lives in a workspace: at `/<ws>/<path>` (Home at `/<ws>/`), `<ws>` one of the person's workspaces the page lives in (those its `workspaces` names, every one when it names none, listed in the sidebar or not), the shell renders it in the chrome's content area (`active.element`, `active.title`), with props `{ user, path, workspace, navigate(path) }`, and the chrome is told that workspace; a module of the workspace by the same id is that module. A bare `/<path>` of a link made before is replaced by the page in the global workspace, its query and fragment kept, so there a host page wins over a workspace of the same name; `/` lands as it always did. `signIn` is shown, when `person()` says nobody, at whatever path was asked, inside the chrome kit's `AuthLayout`, with `{ signedIn() }` reloading that path (status 401, the chrome's stylesheet and kit then public, nothing of any module in the page). And `handed(req, person)` — *what a page gets up front*: its answer rides in the document as `window.__ATELIER__.handed` (null when it throws; nobody's document carries none), so a page can draw from what the host already knows instead of asking again. Without it: a plain instance, and the header is ignored. A file that does not load stops the start |
| `installPath` | _(the instance folder)_ | — | `{ "modules": "<path>", "chromes": "<path>" }` — where `atelier add` places **new** module working copies, chromes separately (keep them in different repos under different agent rules); external installs are path-mounted into `modules:` automatically, and `update` finds them there. Tooling-only — the server ignores it |
| `modules` | _(all run)_ | — | the module filter below |

#### Module filter — top-level entries

Each entry in a list is one of:

| Entry | Meaning |
|---|---|
| `"foo"` | Include the global module `foo` (= `global/foo`) |
| `"!foo"` | Deny the global module `foo` |
| `"./path"`, `"~/path"`, `"/abs/path"` | Mount the directory as a global module. `id` defaults to `basename(path)` |
| `{ "path": "./dir" }` | Same. Allow `"id": "..."` to override the dir name |
| `{ "workspace": "bigcorp" }` | Include all of workspace `bigcorp` |
| `{ "workspace": "!bigcorp" }` | Deny all of `bigcorp` |
| `{ "workspace": "bigcorp", "modules": [...] }` | Include `bigcorp` with an internal filter — the same bare-name / `!deny` / path rules apply to its `modules:` |

#### How the filter behaves

- **No config file (or no `modules` key)** — everything runs.
- **List has any allow markers** (bare name, path, `{workspace: "ws"}`, or `{workspace: "ws", modules: [...]}`) → **allow mode**: only explicitly listed things run. Workspaces not listed are excluded entirely.
- **List has any deny markers** (`"!foo"`, `{"workspace": "!ws"}`) → **deny mode**: everything runs *except* the listed denials. Workspaces not denied stay included.
- **Mixing allow + deny at the same level** → config error, filter falls back to "no filter applied at this level" (everything runs). A one-line warning logs at startup.
- **Empty list `[]`** → "filter to nothing" at this scope.
- **Paths are additive** — they always mount, regardless of allow/deny mode. They bypass the name filter.
- **Inside a workspace's `modules: [...]`** — the same bare-name / deny / path rules apply (you can't nest a `{ "workspace" }` object one level deeper). Bare names refer to that workspace's modules. Paths inside a workspace default to `<that-workspace>/<basename>`.

#### Examples

```json
{ "modules": ["kanban"] }
```
Only `global/kanban`. No workspaces.

```json
{ "modules": ["!archived"] }
```
All globals except `archived`. All workspaces, untouched.

```json
{ "modules": [{ "workspace": "bigcorp" }] }
```
Only `bigcorp`, all its modules. No globals, no other workspaces.

```json
{ "modules": ["kanban", { "workspace": "bigcorp", "modules": ["!wip"] }] }
```
`global/kanban` + all of `bigcorp` except `bigcorp/wip`.

```json
{ "modules": ["~/work/external-mod", "kanban"] }
```
`global/kanban` + the external folder mounted as `global/<basename>`. No workspaces.

#### When the filter applies

The `modules` filter is re-read **per request**, so editing it is live: when `hotReload` is on, the file change triggers a reload; backends no longer in the list are unmounted on the next reconcile, and newly-listed ones mount on the next request. (Settings — `port`, `defaultChrome`, `auth`, etc. — are read once at startup; changing them needs a restart.)

#### Bypass — standalone mode

`npm run dev:module -- <id>` (i.e. `node server.js <id>`) loads just that one module regardless of the filter. A bare id resolves to `global/<id>`; pass `<workspace>/<id>` for a workspace module. A standalone id that resolves to no module **fails fast** — the shell lists the available modules and exits. (A typo in `atelier.config.json` is never fatal by contrast: an unresolvable **path** entry warns once, and an unknown bare name is silently dropped by the filter.)

### What counts as a module

`discoverModules` walks the instance root and treats any sibling directory with a `frontend.jsx` or `backend.js` as a module — skipping reserved names, `_`/`.`-prefixed folders, and recursing into `$<ws>/` workspaces. The complete set of special names, prefixes, and files is in **[Modules → Folder & file conventions](./MODULES.md)**.

## Debugging a live instance — `observe`

Off by default: a normal instance runs **none** of this. Setting `"observe": true` (env `ATELIER_OBSERVE`) turns on the shell's request-observability layer — observe-only, it enforces nothing:

- **`GET /_atelier/inflight`** (auth-gated; `404` when off, like older shells) — a live snapshot of every request the shell hasn't answered yet, oldest first: `{ count, total, inflight: [{ method, url, age_ms }] }`. Old entries are the "squatters" that eat a browser's ~6-per-origin socket budget — curl it even when the browser is wedged, since curl opens its own connection. `total` is a monotonic requests-since-boot counter: difference it on an interval and you have requests-per-time for free. `byRoute` is the same, bucketed by who each request was for (`api/<ws>/<id>`, `modules/<ws>/<id>`, `assets`, `_atelier`, `other`) — differenced, it answers "which module is producing the traffic".
- **`~/Library/Logs/atelier-requests.log`** (written where that folder exists; silent elsewhere) — one line per noteworthy request: `slow` (answered, but slower than `ATELIER_SLOW_REQ_MS`, default 5000), `gone` (client gave up before the answer), `WOULD-KILL` (still unanswered after `ATELIER_WOULD_KILL_MS`, default 120000 — what a future server-side response deadline *would* have killed).
- **Client-error relay** — every page installs a small reporter (only when `observe` is on): uncaught errors, unhandled rejections, and first-per-message `console.error` calls (kind `console` — React dev warnings live here) POST to `/_atelier/client-errors` (throttled to 10/min per page) and fan out as `{type: 'client-error'}` frames on the shell WS topic, where a diagnostics module can collect them. The shell stores nothing; delivery is ACL-gated by the page's module.

Trust note: the snapshot shows every in-flight request's URL to any authed user, across workspaces — turn it on for instances whose users are trusted operators, off for multi-tenant deployments.
