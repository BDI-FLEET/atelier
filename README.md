<!-- Hero banner. Animated SVG (SMIL) — renders and animates on GitHub via <img>.
     Hosted in github.com/pA1nD/pa1nd-media (not in this repo) to keep it lean. -->
<p align="center">
  <img src="https://raw.githubusercontent.com/pA1nD/pa1nd-media/main/atelier/banner-painter-animated.svg" alt="Atelier: a luminous painter creating agent helpers in a starlit seaside studio" width="100%" />
</p>
<!-- Static fallback if GitHub ever fails to animate the SVG:
<p align="center">
  <img src="https://raw.githubusercontent.com/pA1nD/pa1nd-media/main/atelier/banner-painter.jpg" alt="Atelier: a luminous painter creating agent helpers in a starlit seaside studio" width="100%" />
</p>
-->


<h3 align="center">Become the creator.</h3>

<p align="center">
  A framework for agent-driven development. You command the agents that build;<br>
  the shell turns each folder into a live, multi-tenant app — and stays the only boundary you trust.
</p>

---

Atelier is an **app shell + module runner**. Point your agent at a folder — a `frontend.jsx` and/or a `backend.js` — and it becomes a routed, hot-reloading, real-time module. The shell handles routing, bundling, a shared real-time WebSocket, workspaces, and (optional) auth, so a module stays a file or two of React and a handful of route handlers.

```
my-studio/
  node_modules/@pa1nd/atelier     the shell (or a checkout at ./atelier/)
  notes/              →  /global/notes       a module (a folder with a frontend.jsx)
  $acme/board/        →  /acme/board         a workspace module
```

The whole shell is **one package**, and your modules ship **zero dependencies of their own** — no React, no bundler, no WebSocket client to vendor. It ships **zero pixels and zero assumptions**: no default theme, no dev/prod notion. An instance is a folder you run.

> **Platform.** Atelier runs anywhere Node 24+ does — there is no OS-specific install layer (you run it; your process manager / PaaS / reverse proxy is your concern).

## Quickstart

```sh
npm create @pa1nd/atelier my-studio    # scaffold a tiny instance that depends on @pa1nd/atelier
cd my-studio && npm install
npm run dev                            # http://localhost:1844 (override with PORT=…), hot reload, discovers sibling modules
```

Or add the shell to an existing folder — `npm install @pa1nd/atelier`, then `npx atelier`: the folder that owns `node_modules` is the instance. Install modules with `npx atelier add <source>` — a collection's git repo on GitHub, any git url, a served collection on your network, or a local folder/bundle ([docs](docs/INSTALL.md)). (Working from a checkout of this repo instead? The subfolder layout still works: the instance is the folder *containing* `atelier/`; run `npm install && npm run dev` inside `atelier/`.)

The folder you run in **is** the instance. Its [`atelier.config.json`](docs/README.md#configuration--discovery) is the source of truth (which modules run, which chrome, port, auth, …); environment variables override it at startup. Want a second instance? Run a second folder — or the same folder with different startup config (e.g. a different `PORT` and `auth`).

You'll see an "add a chrome" screen until you install a chrome module — the shell ships no chrome and has no built-in theme. Write or install one (a global-workspace folder exporting `meta = { isChrome: true, hidden: true }` and a `chrome` function) and point your config's `defaultChrome` at it. See [Modules → the chrome](docs/MODULES.md#special-module-the-chrome).

## Write a module

Scaffold one — paste this next to `atelier/` (or anywhere your config path-mounts):

```bash
mkdir -p hello && cat > hello/frontend.jsx <<'EOF'
export const meta = { name: 'Hello', icon: 'sparkles' }   // icon: any lucide name
export default function Module() {
  return <div className="p-8 text-xl">hello from a module</div>
}
EOF
```

Reload — it appears in the rail. A folder with a `frontend.jsx` is the whole requirement. Add a `backend.js` for an API:

```js
// hello/backend.js — routes mount at /api/<workspace>/hello
export default {
  mountRoutes(router, ctx) {
    router.get('/ping', (req, res) => res.json({ ok: true, from: ctx.qualifiedId }))
  },
}
```

The full contract — `ctx`, the real-time WebSocket, `ctx.module(id)` slots, hot-reload teardown, the chrome slot, `@atelier/kit`, workspaces, and `atelier.config.json` — is in the [documentation](#documentation).

## Each module apart: a process, a frame, a declaration

`atelier start` (or a bare `atelier`) runs the instance in this folder. For each module it starts the backend as its own node process, builds the frontend, and serves the chrome, which shows every module in a frame on its own origin. Saving a file rebuilds and reloads that module alone. A module that crashes or loops takes down its own process and nothing else.

- **A process per backend.** Every `backend.js` runs in its own node process. A crash or a loop ends that process: one line in the log, the module's lane answers 500 with the error, a fresh process after 1 s, 2 s, 4 s … at most 30 s. The others keep running. Modules share no memory.
- **A frame on its own origin.** Every module is shown in an iframe on `http://<id>.localhost:<port>`, where the shell serves that module and nothing of itself. The module cannot read the page, the sidebar or another module. A small bridge carries the route, the title, the theme, ⌘K, Esc and "dim for a modal".
- **module.json.** The module's declaration: `name`, `icon`, `group`, `color`, `primary`, `release`, `agent`. Unknown keys are ignored and reported. Without one, a module runs on its frontend's `meta`.
- **ctx.caller.** Who is calling, as verified before the request reached the module; `null` on an ungated instance.
- **Hosted.** The `hosted` setting names a file a host gives: who the person is (`person(req)`), where the sidebar comes from (`sidebar(req, person)`), and the trust in its `X-Atelier-Caller` header. Without it, a plain instance.

Details: [Modules](docs/MODULES.md), [settings](docs/README.md#settings).

## The identity

Under a host, the shell wears one identity: a midnight ground, paper text, a Garamond voice, gold for the one thing that is alive. It has one owner, `identity.css`, a stylesheet beside the shell's files that `hosted.js` serves at `/_atelier/identity.css` (to anyone, never kept) and `index.html` names right after the chrome's stylesheet, in the signed-out document and the signed-in one. Nothing of the identity is written anywhere else in the shell: it is unlayered, so it wins over the chrome's `@layer theme`, and it changes the chrome's own variables rather than its files.

- **Faces.** `--font-sans` Inter, `--font-serif` Cormorant Garamond, `--font-mono` JetBrains Mono, each a `@font-face` over a woff2 file under `fonts/` (served at `/_atelier/fonts/<file>`, kept a year: a file's name carries its version), `font-display: swap`. The body is set in `--font-sans`; a page picks the serif where it wants it.
- **Tokens.** `--ink`, `--panel`, `--sheet`, `--paper`, `--muted`, `--caps`, `--live`, `--live-bright`, `--line`, `--edge`. The pages refer to them by name; the names are a contract.
- **The chrome's colours.** `--color-zinc-50` to `--color-zinc-950` are remapped from paper to ink, so the chrome's and the pages' zinc classes wear the identity; `--color-lime-400` and `--color-lime-500` are `--live`. White stays white. Light mode is paper with ink text, dark mode (the identity's home) midnight with paper text.
- **The fonts.** Latin subsets fetched from Google Fonts (`fonts.googleapis.com/css2`, the files on `fonts.gstatic.com`): Inter (one variable file, 400 to 600), Cormorant Garamond (one variable file upright and one italic, 400 to 500), JetBrains Mono 400. Each family is under the SIL Open Font License, its text beside the files (`fonts/OFL-*.txt`).

## Signing in to a host

The CLI can sign you in to a host — a server that runs Atelier apps for other people, each on a computer of its own — through its portal, the host's web page where a person signs in. The CLI opens the portal's /activate page in your browser with the code in the link; you approve it there, where you are signed in (or sign in first), and the waiting command finishes:

```
$ atelier login
Welcome to the atelier · 0.22.0
  (a horse, drawn in block characters)
This signs this terminal in to your atelier at http://127.0.0.1:4350: approve it in the browser that just opened.

Browser didn't open? Use the link below (c to copy)
http://127.0.0.1:4350/activate?code=DOJ83-KKIUQ
Code DOJ83-KKIUQ

waiting … signed in as Alex
```

`--no-browser` opens nothing (the link and the code are printed for another machine); `--plain`, and any output that is no terminal, prints the words without colour or picture. Ctrl-C stops waiting.

The page names what is asking ("The atelier CLI on a laptop wants to act as you"). The code is single-use and lives ten minutes. In dev you can also sign in with your number: the host sends a code from the agent's number, in a chat where no model answers.

```sh
atelier login +15555550100       # dev: a code is sent to the number; type it at the code: prompt
atelier whoami                   # acting as Alex · at http://127.0.0.1:4350
atelier whoami --grants          # and what you may do, in words
atelier logout                   # end the session on the host and forget it here
```

There is one default host: `ATELIER_HOST`, else `http://127.0.0.1:4350`. `--host <url>` signs in to another one, for that call only; it never moves the default. The session is kept in `~/.config/atelier/credentials`, one entry per host, readable by you alone, and is never printed. Signing in says who you are and grants nothing: what you may do is the grants `whoami --grants` lists.

## Attaching to a workspace

`atelier attach` opens a terminal into a workspace on a computer, through the host, with your login: the workspace's shell, kept by the computer whether anyone is attached or not. You never have a user on that machine; what you can reach from it is what the workspace can reach.

```sh
atelier attach                   # the remote computer's main
atelier attach k1                # a bare name is a computer: k1/main
atelier attach /pair             # a leading slash: a workspace on the remote
atelier attach k1/main --watch   # the full path always works; --watch: see the screen, your keys are not sent
```

The remote is the one `atelier remote <computer>` set on the module folder you are in (its git remote `atelier`, on the host you are talking to). Outside a module folder, with one computer, that one; with several, the CLI does not pick: it names them and asks you to name one or set the remote. A computer is named by the word `atelier computers` prints, or by the host's own name for it (`k1`).

```
attached · k1/main · also here: Sam
~ $ git -C repos/billing-api status
[Sam] ~ $ npm test -- invoice
…
detached · the workspace keeps running · handover written
```

The host checks that you may sit in that workspace — you are a member of the chat it serves — (or watch it). Several people may be attached at once: everyone sees the same screen and may type, every line typed is on the host's record with its author, and a line someone else started typing shows their name in front of it. `Ctrl-]` detaches; the shell and everything in it stay, and the next attach finds them. The last one out of the workspace (its shell or its agent's session) leaves a handover for the primary agent (else: "others still here"). `exit` (or `Ctrl-D`) ends the shell itself: you are detached, and the next attach starts a new one.

`atelier agent attach` puts your terminal in front of one agent instead of the shell: its live session, kept open by the computer whether anyone is attached.

```sh
atelier agent attach                   # the remote computer's main: you type into its session
atelier agent attach k1/main --watch   # see the screen; your keys are not sent
```

```
attached · k1/main · also here: nobody · typing to the agent
…
detached · the workspace keeps running · handover written
```

Talk and attach are one right: you type into the agent's session, as into the shell (ask it why it said what it said). The agent types the chat's messages into the same input, so your keys go through it: while it types one, your keys wait a moment; while you type (a key in the last 3 seconds), it waits for you, and it never clears what you typed. What the agent says to your line stays on its screen; it is never a reply in the chat. Every line is on the host's record with its author, and a line someone else typed shows their name. `--watch`: the screen only. The footer, `Ctrl-]` and the handover are as for `attach`.

Both verbs: exit 0 done, 1 refused or failed, 2 written wrongly, 3 not signed in on that host, 4 signed in but no grant (the message names the line you would need, built from the name you typed: the same answer for a workspace that is not yours and one that does not exist).

## Computers

Behind a host an app lives on a computer: the one behind every chat, a team's, and your own. `atelier computers` lists the computers you hold a grant on; it is the list to pick from for a remote.

```
$ atelier computers
  alex-sam     your chat with Sam · 2 modules
  alex         your own · 1 module
  example-co   shared with your team
$ atelier remote alex-sam
remote → alex-sam · workspaces: main
```

`atelier remote <computer>` points this module at an app on that computer. The app's name is module.json's `name` (lower case, dashes), else the folder's. The remote is called `atelier` unless `--name` says otherwise, which is how a second environment is added. It is a plain git remote, `<host>/git/<computer>/<module>.git`: `git remote -v` shows where an app lives, `git remote remove` undoes it. Nothing is pushed.

## Deploying

An app gets to its computer by `atelier push`, which is a git push whose answer is printed in your terminal. The first time, `atelier create` makes the module and points it at your own computer:

```
$ atelier login
$ atelier create reading-list
project reading-list · in your space · remote "atelier" set
$ cd reading-list
$ atelier push
remote: -----> reading-list: building 9c04e1f
remote: -----> runtime started
remote: -----> live: reading-list @ 9c04e1f
in your sidebar on the portal
```

`create [name]` makes the folder `name/` (or, without a name, takes this folder, the app named as its module.json names it, else after the folder, as `atelier remote` names it) with a module.json, the hello module, a `.gitignore` for `data/` and `node_modules/`, a repository and its first commit. Signed in, it sets the remote `atelier` to your own computer; not signed in, it says so and the folder is made all the same.

`push [remote] [commit]` takes the remote as a plain argument, as git push does, and uses the remote named `atelier` when none is given; the commit is HEAD unless named. The host gives the CLI a token for this one push, this one module, five minutes; git pushes with it, and the host builds, backs up the data, runs the release script and switches before it accepts. Everything it prints reaches your terminal as it happens, each line marked `remote:`. A refused push never touched the running app. Going back is a push of an older commit: `atelier push atelier 81d07e4`.

`releases [-r remote]` is what was live and when: `9c04e1f · 2026-10-06 14:05 · Alex · live`, newest first, with the restarts, config changes and data pushes between them.

One convention for every verb, so an agent can act on the code alone: 0 done (for push: the app is live on the commit that was printed), 1 the host refused or the work failed, nothing half-done, 2 written wrongly, 3 not signed in on that host (run `atelier login`), 4 signed in but the grant is missing (the message names the grant, never who else holds what). What the CLI asks of the host, and how the token reaches git without being stored anywhere: [docs/CLI.md](docs/CLI.md).

## Looking after a live app

Every other verb that names a remote reaches the live app through the host, which checks on each call that the caller may do it: your maintain grant on that app, the same one `push` needs. A person and an agent use the same verbs with the same rights: what a person can do from a laptop, an agent can do from its chat's computer, and the host's record shows which of them did what. In a module folder, with `-r <remote>`:

```
$ atelier ps -r atelier
notes · live 9c04e1f · awake since 7 Oct 14:05 (12 min) · pid 4242
last request: 14:16 GET /api/global/notes/list 200 3ms · config: 2 keys
$ atelier logs -f -r atelier                 # its output, its requests with their status, the runtime's lines
$ atelier config set CRM_MAIL_HOST=imap.example.org -r atelier
remote: 1 key set · notes restarted
$ atelier config -r atelier
CRM_MAIL_HOST   set 7 Oct 09:41 by Alex
$ atelier run -r atelier -- node fix-projects.js
remote: running as notes, beside its data
2 rows moved to "Client visits"
remote: done · recorded: Alex, a laptop, 09:52
$ atelier restart -r atelier
remote: notes restarted · live 9c04e1f · pid 4311
$ atelier data push -r atelier
This replaces the live data of notes in computer alex.
  yours:  48 MB
Type the app's name to continue: notes
remote: live data backed up (12 kB) · data replaced (48 MB) · notes restarted
```

`logs [-f] [--since 1h|30m|09:41]` reads the app's log on its computer (its last 2 MB); `-f` keeps streaming until Ctrl-C. `ps` says the live commit, since when it is awake, the last request. `restart` stops and starts it from the same commit; its `data/` stays. `run -- command` runs beside the app: in its released code, with its `data/` (`ATELIER_DATA`) and its config, at most ten minutes. From a terminal (or with `--tty`) it gets a terminal of its own on the computer, the size of yours: a full-screen program draws, every key goes to it as you type it, Ctrl-] leaves; from a pipe or a file (or `--no-tty`), what you type or pipe in goes to its input line by line. `config` lists the keys, each with when and by whom, never a value; `set` and `unset` change them and restart the app. `data pull` copies a consistent snapshot of the live `data/` into this folder (asking before it replaces one; `--yes`), `data push` replaces the live one after a backup (`--confirm <app>` types the name for a script). Restarts, runs, config changes and data pushes go into the host's record, with who and from which machine or chat, and `releases` shows the restarts, config changes and data pushes beside the pushes. Without `-r` these verbs would act on your own instance, which the CLI does not do: they say so and name the `-r` form.

Inside a workspace one may sit in (the same right as `attach`), `atelier agent [computer][/workspace]` lists its agents, the primary first; `agent new <name> --prompt file` makes one beside it, its prompt held by the computer; `agent primary <name>` names who receives the chat. One session runs per workspace: an agent made beside the primary keeps its prompt, and its session does not start.

## Files

`atelier files push <folder> <computer>:/<path>` copies a folder to a computer's drive, `files pull <computer>:/<path> <folder>` back; only what differs moves, and an interrupted copy picks up where it stopped. `files sync <folder> <computer>:/<path> --up | --down | --both` keeps them in step; with `--both` a file changed on both sides keeps the newer one and the other beside it, `notes (agent, 7 Oct 08.31).md`. Push needs files write on that computer, pull files read. Nothing is deleted on either side; there is no `--watch` (run sync from a timer).

```
$ atelier files push ./research alex:/research
comparing … 412 files, 1.8 GB to send
done · 412 files · 6 min 12 s
```

## Adding a module

A module is a git repository. `atelier add <git-url>` clones it into the instance folder; `atelier update [module]` pulls it, and every module with a remote when none is named. A collection given to `add` or `update` is subscribed to and installed, or brought up to its latest cut; `package`, `publish` and `list` cut, move and list collections ([docs/INSTALL.md](docs/INSTALL.md)).

## Documentation

Four pages (a chrome may also surface these in-app), in this order:

- **[docs/README.md](docs/README.md)** — **Atelier**: running an instance, what lives in `atelier/`, and `atelier.config.json`.
- **[docs/INSTALL.md](docs/INSTALL.md)** — **Install**: creating an instance, collections and the sharing verbs (`package` / `publish` / `add` / `list`), the shipping convention.
- **[docs/MODULES.md](docs/MODULES.md)** — **Modules**: module shape, `ctx`, real-time (`self`/`broadcast`), hot-reload, cross-module slots, sidecar servers — plus the special modules (the **chrome** + `@atelier/kit`).
- **[docs/WORKSPACES.md](docs/WORKSPACES.md)** — **Workspaces**: the multi-tenant model (`global` + `$<ws>/`), the `qualifiedId`, rail and picker.
- **[docs/AUTH.md](docs/AUTH.md)** — **Auth**: the auth-module slot, the `user`/`defaultUser` contract, request + WebSocket gating, takeover render.
- **[docs/CLI.md](docs/CLI.md)** — **The CLI and the host**: what `computers`, `remote`, `create`, `push`, `releases`, the maintain verbs (`logs`, `ps`, `restart`, `run`, `config`, `data`), `agent` and `files` ask of a host, the push token, the exit codes.
- **[CHANGELOG.md](CHANGELOG.md)** — version history and migration notes.

## Tests

```
npm test             # node:test characterization suite (zero extra deps)
```

Run it after any change to the shell (`server.js`, `build.js`, `discovery.js`, `client.jsx`, `chrome-resolve.js`).

## Contributing

The shell (`server.js`, `client.jsx`, `build.js`, `discovery.js`, `chrome-resolve.js`) is cross-cutting — changes there are their own task, separate from any single module. If a module needs something the shell doesn't provide, the convention is to name the gap and propose extending the shell rather than reaching around it. Keep the surface small.

## The name

An *atelier* is a painter's studio. The name comes from an old idea — God is the painter, we are the painting; the creator stands outside what's created. Atelier is where that inverts: you step into the painter's role, and the agents become your servants, the way we are to a creator we can't fully know. The studio is where the created learns to create.

## License

[MIT](LICENSE) © 2026 pa1nd.
