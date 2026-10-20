# The CLI and the host: the receiver contract

What `atelier computers`, `atelier remote`, `atelier create`, `atelier push`, `atelier clone` and `atelier releases` ask of a host, and
(below, *The maintain verbs, the agents and the files*) `logs`, `ps`, `restart`, `run`, `config`, `data`, `agent` and `files`. The CLI
is coded against exactly this; the host's receiver (the hook of the host's git) answers it. Every call but the git push carries the
session header the other verbs send, `Authorization: Session <session>`, from `~/.config/atelier/credentials` for that
host.

## The contract

- `GET /api/computers` (session header) → `{ computers: [{ id, label, kind: 'chat'|'own'|'room', line, modules }] }` — the person's computers: `alex-sam` (a chat with one other), `alex` (own), `example-co` (shared with a team; `kind` is the host's word for it). `label` is the short name used in remotes.
- `POST /api/push/token { computer, module }` (session header) → `201 { token, expires, url }` where `url` is the git remote URL to push to (e.g. `http://127.0.0.1:4350/git/<computer>/<module>.git`); the token is good for one push, one module, five minutes. `403 { error }` when the grant (maintain) is missing — the error names the grant. `401` not signed in. A module the computer does not run is made by its first push: the token is minted for a member of a chat that computer serves, the receiver creates the repository and reads the module's name from the pushed `module.json`, and once live the pusher maintains it and it is in the sidebar of the computer's chat; the CLI does nothing different (`atelier create` → `atelier push`).
- The git push goes to `url` over HTTP with the token as the password (user `atelier`), passed WITHOUT touching the user's git credential store, by a one-off `GIT_ASKPASS` helper (below) that never writes the token to disk or to the shell history. The receiver's hook prints its lines on git's sideband; git shows them as `remote: …`; the CLI passes git's output through unchanged (so `remote: -----> …` appears as the receiver printed it) and maps the result to the exit codes: 0 when git succeeded AND the last remote line is `-----> live: <module> @ <commit>`; 1 otherwise (the receiver refuses by exiting non-zero in the hook, nothing half-done); the CLI adds one final line of its own: `in your sidebar on the portal` on success, or nothing.
- `POST /api/clone/token { computer, module }` (session header) → `201 { token, expires, url }`, the push token's read side for `atelier clone`: the same `url`, read with git's `git-upload-pack` on the token as the password (user `atelier`); the token is good for one app, five minutes, as many requests as a clone or a fetch makes, and the receiver checks the grant again at each. Minted on the same grant as a push token (maintain); `403 { error }` names it, `401` not signed in. No first clone: an app the computer does not run is just missing.
- `GET /api/releases?computer=&module=` (session header) → `{ releases: [{ commit, at, by, from, live, op?, what? }] }` for `atelier releases` (`from`: the machine or the computer/sandbox it was pushed from). An entry with `op` is not a push but a restart, a config change or a data push from the host's record: `what` its words (`config 2 keys set`), `commit` the one live then.

## What the CLI does with it, and what the receiver must know

**The remote.** `atelier remote <computer>` and `atelier create` write an ordinary git remote on the module's repository:
`<host>/git/<computer>/<module>.git`, `<host>` being the host's URL. A push reads the host, the computer and the module
back from it, asks that host for the token with the session kept for that host, and pushes to the `url` the token
answer gives. `<module>` is the app's label as the host makes it (`appLabel` in repo.js): module.json's `name`, lower case, every run
of other characters a dash, at most 40; the folder's name when module.json has none.

**The refspec.** `+<branch or commit>:refs/heads/main`: what is pushed becomes the receiver's `main`, forced, because
going back is a push of an older commit: `atelier push atelier 81d07e4`. The pre-receive hook sees `<old> <new>
refs/heads/main` and decides; a refused push leaves `main` where it was.

**How the token reaches git (the one picked).** A one-off `GIT_ASKPASS` helper that holds no token: a 0700 script in a 0700 temp folder
that answers `atelier` when git asks for a username and prints `$ATELIER_GIT_TOKEN` when it asks for a password; the
token is in the environment of the git process only, and the folder is deleted when git ends. Next to it,
`-c credential.helper=` empties git's helper list (a system gitconfig may set a system credential helper, and git stores
a password that worked there), and `GIT_TERMINAL_PROMPT=0`. So the token is never in argv (`ps`), a file, the shell history, a
credential store or the output. The push URL carries no user: with `atelier@` in it, git sends an empty password and
never asks the helper.

**So the receiver must challenge.** Git's first request carries no credentials. The receiver answers it with `401` and
`WWW-Authenticate: Basic realm="atelier"`; git then asks the helper and repeats the request with
`Authorization: Basic base64("atelier:<token>")`. A receiver that answers `403` (or a 401 without the header) to the
first request ends the push before git ever asks. Both requests of one push (`info/refs?service=git-receive-pack`, then
`git-receive-pack`) carry the token; "one push" means one receive-pack.

**Refusal bodies.** The CLI prints `error` from a refusal body, and `refused` (what the host's other routes say) when
there is no `error`.

**The verdict, as built.** Exit 0 when git exits 0 and the last receiver line beginning `----->` reads
`live: <module> @ <hex>`, `<module>` the remote's and `<hex>` a prefix of the commit pushed. Lines after it that do not
begin `----->` are allowed (`remote:        project example-co · runtime awake`), and so is text after the
commit (`live: kb @ 3f9c2ab (was 81d07e4)`). Also exit 0: git says `Everything up-to-date` and the receiver
printed nothing (the commit is `main` already, which only an accepted push makes it). Anything else is 1; when git
succeeded without the live line the CLI says so in one line. `in your sidebar on the portal` is printed on stdout,
unless the receiver printed that line itself.

**The exit codes, every verb:** 0 done · 1 the host refused or the work failed, the host
cannot be reached · 2 written wrongly, outside a module folder, no such remote · 3 not signed in at that host (before
anything is asked of the host) · 4 signed in, the grant is missing (the host's sentence; `atelier remote` to a computer
not in `/api/computers` says `the grant is missing: maintain on <computer>`, the same for one that does not exist).

**Inside a sandbox.** A program a computer started in a sandbox has `ATELIER_SOCKET` (the computer's
socket) and `ATELIER_SANDBOX` (which sandbox it is) in its environment, and no session and no token. There `atelier push`
asks the computer to push: after the socket's `hello { sandbox, cwd }` (the computer checks that the caller runs in
that sandbox's home or a folder in it), one request `push { module, remote, commit }` (the app's label from the remote,
the remote's name, the commit as a full id). The computer reads the commit and the remote's two words from the
checkout the hello named, asks the host for the one-push token on the sandbox's own maintain grant (granted and revoked
apart from any person's), and runs the git push itself with it: the token never reaches the agent, which sees the
remote: lines and nothing else.
The answer streams: one `{ line, id }` per line git printed, as it prints it, then `{ ok: true, code }` (git's exit code),
or `{ refused: '<the host's sentence>' }` before any git runs. The CLI prints the lines on stderr as git would and reads
the same verdict from them; the exit codes are the same (a refusal that names the grant is 4, anything else 1; there is
no 3: a sandbox is never signed in). Nothing of the token is in the CLI's process, its environment or a file in the
sandbox. The receiver records the push as by the sandbox's agent from `<computer>/<sandbox>`, so `atelier releases` shows
`by agent · from k1/main`.

**The clone: a maintainer gets an app's code from the host's git, never its data.** `atelier clone <app> [folder]
[--computer <label>] [--host <url>]` finds the computer the app runs on in `/api/computers` (the computer whose `modules`
list holds the app's `label`; when two of yours run one, the one you maintain, else `--computer` names it; none: `the
grant is missing: maintain on <app>`, exit 4, the same for an app that is not there and one that is not yours), asks
`POST /api/clone/token` for it and runs `git -c credential.helper= clone -q -o atelier <url> <folder>` (the folder
defaults to the app's label and must not exist, or be empty; checked before anything is asked), the token handed the
way a push hands it: a one-off `GIT_ASKPASS` helper printing `$ATELIER_GIT_TOKEN`, deleted when git ends. Then the
remote `atelier` is set as `atelier remote` sets it (`<host>/git/<computer>/<app>.git`, the host you signed in at), so
`atelier push` from the folder pushes back; a repository without a `.gitignore` gets one with `data/` and
`node_modules/` (left uncommitted). One line: `cloned <app> at <short commit> · remote atelier → <computer>`. The token
is never in argv, the repository's config or the output. Exit codes as above (2 also for a folder that exists, or an
app on two computers with none named). `atelier files pull computer:/apps/<app>` copies the live folder with its
`data/`: the owner's way, never the maintainer's. Inside a sandbox the agent's clone tool clones (the computer holds
the token); `atelier clone` there says so and exits 2.

**Optional fields the CLI reads.** A computer's `workspaces` (names, or `{ name }`), shown by `atelier remote`
(`main` when absent). A computer's `modules` may be a number or a list.

## The maintain verbs, the agents and the files

Every other verb that names a remote reaches the live app through the host, which checks on each call that the caller
may do it. One shape for all of them, an *op*: the CLI names the app as a push does (the remote's computer and
app), the host checks the grant and sends the op to that computer, and what the computer says comes back as it says it.

**From a machine** (the session header on every call):

- `POST /api/ops { computer, module?, workspace?, op, machine }` → `201 { op, computer }`. `op` is the verb and its
  arguments: `{ verb: 'logs', since?, follow? }`, `{ verb: 'ps' }`, `{ verb: 'restart' }`, `{ verb: 'run', argv, tty? }`,
  `{ verb: 'config', set?: [KEY…], unset?: [KEY…] }` (names only), `{ verb: 'data-pull' }`, `{ verb: 'data-push', confirm }`,
  `{ verb: 'files-push' | 'files-pull', path }` (no module: the computer's drive), `{ verb: 'agents' }`,
  `{ verb: 'agent-new' | 'agent-primary', name }` (a workspace instead of a module: `computer` as `attach` names it,
  the person's own when absent). `machine` names this machine in the host's record (its hostname, or `ATELIER_MACHINE`). `403 { error }` names the
  grant: `the grant is missing: maintain on notes`, `… files write on alex`, `… member of the chat k1/main serves`; the
  same answer for an app that is not yours and one that is not there. `400 { error }` written wrongly, `401` not signed in.
- `GET /api/ops/<op>/stream` → JSON lines: `{ started }` once the computer took it, then `{ line }` (the computer's own
  words: printed `remote: …` on stderr), `{ out }` (output as it came: a run's, the log's, a listing; printed as it is on
  stdout), and `{ done, code }` at the end; `{ closed }` when the computer went quiet. Closing the stream stops a
  followed log or a run.
- `POST /api/ops/<op>/in` → the computer's answer, after `{ started }`: a run's input `{ keys }` and `{ eof }` (with
  `tty`: `{ size: { cols, rows } }` first, before anything draws, and again on a resize; `{ keys }` raw, as typed; its
  `{ out }` is the bytes of the command's own terminal, escape sequences and all); `config
  set`'s `{ values: { KEY: value } }` (values travel only here, never in the op the host records); `agent new`'s
  `{ prompt }`; bytes in 256 KB pieces, base64: data push `{ put: 'data', at, data }` … `{ end, size, sha256 }`, data pull
  `{ get: 'data', at }` → `{ data, at, size, sha256? }` … `{ end }`; files push `{ have: [{ path, size, sha256 }] }` →
  `{ need: [{ sha256, from }] }` (what the drive lacks, and how much of each it holds from an earlier try),
  `{ put: <sha256>, at, data }` → `{ at }`, `{ place: [{ path, size, sha256 }] }`, `{ end }`; files pull
  `{ list, after? }` → `{ files: [{ path, size, sha256, mtime }], more }`, `{ get: <path>, at }` → `{ data, at, size }`,
  `{ end }`. Up to 1 MB a call.

**Inside a sandbox** (`ATELIER_SOCKET`, `ATELIER_SANDBOX`), no session: after the hello, one socket request
`op { computer?, module?, workspace?, op, values?, prompt?, into?, from? }`; the computer asks the host on the sandbox's
own maintain grant (as for a push) and does it, streaming `{ line, id }` and `{ out, id }`, then
`{ ok: true, code }`, or `{ refused }` before anything ran. What the host's `/in` carries rides the request instead:
`values` (config set), `prompt` (agent new); a data snapshot is a file in the caller's folder (`into` for a pull, `from`
for a push). Only the apps of the sandbox's own computer; a run gets no input there; files are a machine's verb.

**Exit status** for all of them, as for every verb: 0 done · 1 the host refused or the work failed (a run whose command
exited non-zero: its code is printed) · 2 written wrongly, outside a module folder, no such remote · 3 not signed in at
that host · 4 the grant is missing (the host's sentence). Without `-r`, the maintain verbs would act on your own instance,
which the CLI does not do: they say so and exit 1.
