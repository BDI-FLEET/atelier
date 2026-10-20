#!/usr/bin/env node
/* Atelier bin — dispatches the verbs (USAGE lists them); anything else is the server: `atelier` (host mode),
 * `atelier <id>` / `atelier <ws>/<id>` (standalone).
 *
 * The verbs are reserved words for standalone mode: a module literally named `add` can still be run with
 * `node server.js add`. A word that is no verb and no module folder here prints the usage and exits 2.
 */
const VERBS = new Map([
  ['add', './add.js'],
  ['update', './update.js'],
  ['package', './package.js'],
  ['publish', './publish.js'],
  ['list', './list.js'],
  ['login', './login.js'],
  ['whoami', './whoami.js'],
  ['logout', './logout.js'],
  ['attach', './attach.js'],
  ['create', './create.js'],
  ['remote', './remote.js'],
  ['clone', './clone.js'],
  ['computers', './computers.js'],
  ['push', './push.js'],
  ['releases', './releases.js'],
  ['logs', './logs.js'],
  ['ps', './ps.js'],
  ['restart', './restart.js'],
  ['run', './run.js'],
  ['config', './config.js'],
  ['data', './data.js'],
  ['files', './files.js'],
]);
// `atelier agent attach` is its own client; `agent`, `agent new`, `agent primary` are agent.js
const AGENT = new Map([['attach', './agent-attach.js']]);
// The usage: one line per verb (`atelier help`, `--help`, `-h`, and a word that is no verb)
const USAGE = `usage: atelier <verb> [args]
  atelier                       run the instance in this folder (atelier start [--port n] the same)
  atelier <module>              one module of this folder, standalone (<workspace>/<module> for a workspace's)
  atelier login                 sign in to a host: approve the code on <host>/activate (--host <url>)
  atelier whoami                who this machine acts as, on which host (--sessions, --grants)
  atelier logout                sign out of a host
  atelier computers             the computers you hold a grant on
  atelier create [name]         a module folder with its repository; the remote atelier to your own computer
  atelier remote <computer>     point this module at a computer (--name <remote>: a second environment)
  atelier clone <app> [folder]  an app you may push: its code from the host's git, never its data; the remote atelier set
  atelier push [remote] [commit]  make the app live: a git push whose answer is printed as remote: lines
  atelier releases [-r remote]  what was live and when: pushes, restarts, config changes, data pushes
  atelier logs [-f] [--since t] [-r remote]   the app's log: its output, its requests, the runtime's lines
  atelier ps [-r remote]        the live commit, awake or resting since when, the last request
  atelier restart [-r remote]   stop and start the app from the same commit (recorded)
  atelier run [-r remote] -- cmd   a command beside the live app, in its code, with its data/ and config (recorded)
  atelier config [set K=v… | unset K…] [-r remote]   the app's settings and secrets; values never shown
  atelier data pull | push [-r remote]   the live data/ down into this folder, or this folder's up (recorded)
  atelier attach [c][/w]        a terminal into a workspace: its shell, through the host (--watch: see only)
  atelier agent [c][/w]         the agents in a workspace; agent new <name> [--prompt file]; agent primary <name>
  atelier agent attach [c][/w]  your terminal in front of an agent's live session, you type into it (--watch: see only)
  atelier files push | pull | sync   a folder to and from a computer's drive: computer:/path (sync --up|--down|--both)
  atelier add <git-url>         clone a module's repository into this instance
  atelier update [module]       pull it; every module with a remote when none is named
  atelier package <module>      cut a checked snapshot of a module into a collection
  atelier publish <collection>  move a collection somewhere others can add it from
  atelier list                  your collections and what they offer
  atelier help                  this`;
/**
 * A word that is no verb is a module of this folder only when a module folder of that name is here (`<id>/`, or
 * `$<workspace>/<id>/` for `<workspace>/<id>`, holding a frontend.jsx, a backend.js or a module.json): the standalone
 * mode. Anything else is a mistyped verb: the usage, exit 2.
 */
async function isModuleHere(word) {
  const fs = await import('node:fs'), path = await import('node:path');
  if (!/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(word)) return false;
  const [a, b] = word.split('/');
  const dirs = b ? [path.join(process.cwd(), `$${a}`, b), path.join(process.cwd(), a, b)] : [path.join(process.cwd(), a)];
  return dirs.some((d) => ['frontend.jsx', 'backend.js', 'module.json'].some((f) => fs.existsSync(path.join(d, f))));
}
const word = process.argv[2];
const verb = VERBS.get(word);
if (word === 'help' || word === '--help' || word === '-h') {
  console.log(USAGE);
  process.exit(0);
} else if (word !== undefined && word !== 'start' && word !== 'agent' && !verb && !(await isModuleHere(word))) {
  console.error(`\natelier: "${word}" is not a verb${/^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(word) ? ', nor a module folder here' : ''}\n\n${USAGE}\n`);
  process.exit(2);
}
if (word === 'start') {
  // `atelier start [--port n]`: the instance in this folder. Same server as a bare `atelier`.
  const rest = process.argv.slice(3);
  const i = rest.indexOf('--port');
  if (i >= 0) {
    const n = Number(rest[i + 1]);
    if (!Number.isInteger(n) || n <= 0 || n > 65535) { console.error('\natelier start: --port takes a port number\n'); process.exit(2); }
    process.env.PORT = String(n);
    rest.splice(i, 2);
  }
  if (rest.length) { console.error(`\natelier start: unknown ${rest.join(' ')} · atelier start [--port n]\n`); process.exit(2); }
  process.argv.splice(2);
  await import('./server.js');
} else if (process.argv[2] === 'agent') {
  const sub = AGENT.get(process.argv[3]);
  if (sub) { process.argv.splice(2, 2); await import(sub); }   // agent attach reads its args from argv[2…]
  else { process.argv.splice(2, 1); await import('./agent.js'); }   // agent [target], agent new, agent primary
} else if (verb) {
  process.argv.splice(2, 1);   // the verb reads its args from argv[2…]
  await import(verb);
} else {
  await import('./server.js');
}
