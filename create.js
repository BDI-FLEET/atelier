#!/usr/bin/env node
/* atelier create — makes a new project in your own space, named as the
 * folder's module.json names it, else after the folder, unless you give a
 * name, and sets this module's atelier remote to it.
 * If the folder is not a git repository yet, it becomes one, with data/ and
 * node_modules/ ignored. Nothing is pushed.
 *
 *   atelier create [name] [--host <url>]
 *
 *   project reading-list · in your space · remote "atelier" set
 *
 * With a name: a new folder <name>/ holding the hello module (module.json,
 * frontend.jsx, backend.js), a .gitignore, a repository and its first commit
 * "atelier create <name>". Without one: this folder, its app named as every
 * verb that finds the module here names it (repo.js appOf); what it
 * lacks is added (module.json; the hello module only when it has neither a
 * frontend.jsx nor a backend.js; .gitignore) and committed, those files alone,
 * so a push carries them; a repository with history keeps it.
 *
 * The remote atelier points at your own computer (the one `atelier computers`
 * calls "your own"): <host>/git/<computer>/<name>.git. Creating works offline:
 * not signed in, the folder is made and the line says how to point it later.
 *
 * Exit 0 done · 1 git or the host failed · 2 written wrongly, or <name>/
 * exists already.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readCredentials, resolveHost, askHost, sessionFor, unreachable, notSignedIn, COMPUTERS_PATH } from './session.js';
import { DEFAULT_REMOTE, GITIGNORE, appOf, git, remoteUrl, setRemote } from './repo.js';
import { failer } from './ops.js';
import { MODULE_JSON, BACKEND_FILE, FRONTEND_FILE } from './module-json.js';
import { readArgs, helpOf, HOST } from './args.js';

const SPEC = {
  usage: 'atelier create [name] [--host <url>]',
  words: [['name', 'a new folder with that name (default: this folder, named after it)']],
  options: [HOST],
  most: 1,
};
const fail = failer('create');

const { opts, words: [given = null] } = readArgs(process.argv.slice(2), SPEC, fail);
if (given !== null && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(given)) fail(`"${given}" isn't a folder name: letters, digits, - _ .\n\n${helpOf(SPEC)}`);

const dir = given ? path.resolve(given) : process.cwd();
const { name, label } = appOf(dir);
if (!label) fail(`"${name}" leaves no name for the app: give one, atelier create <name>`);
if (given) {
  if (fs.existsSync(dir)) fail(`${given}/ exists already`);
  fs.mkdirSync(dir);
}

const added = [];
const write = (file, text) => { fs.writeFileSync(path.join(dir, file), text); added.push(file); };
const put = (file, text) => { if (!fs.existsSync(path.join(dir, file))) write(file, text); };
put(MODULE_JSON, JSON.stringify({ name }, null, 2) + '\n');
if (!fs.existsSync(path.join(dir, FRONTEND_FILE)) && !fs.existsSync(path.join(dir, BACKEND_FILE))) {
  write(FRONTEND_FILE, `export default function Module() {
  return <div className="p-8 text-xl">hello from ${name}</div>
}
`);
  write(BACKEND_FILE, `// routes mount at /api/<workspace>/${path.basename(dir)}
export default {
  mountRoutes(router, ctx) {
    router.get('/ping', (req, res) => res.json({ ok: true, from: ctx.qualifiedId }))
  },
}
`);
}
put('.gitignore', GITIGNORE);

// a repository of its own (never the one of a folder around it) with a first commit; the author is yours when git
// knows you, else "atelier"
const top = git(dir, ['rev-parse', '--show-toplevel']);
if (top.code !== 0 || fs.realpathSync(top.out) !== fs.realpathSync(dir)) {
  if (git(dir, ['init', '-q', '-b', 'main']).code !== 0) fail('git init failed', 1);
}
// a repository with history keeps it: only the files create added are committed, nothing of yours
const who = git(dir, ['config', 'user.email']).out ? [] : ['-c', 'user.name=atelier', '-c', 'user.email=atelier@localhost'];
const fresh = git(dir, ['rev-parse', '--verify', '-q', 'HEAD']).code !== 0;
const paths = fresh ? ['.'] : added;
if (paths.length) {
  if (git(dir, ['add', '--', ...paths]).code !== 0) fail('git add failed', 1);
  const c = git(dir, [...who, 'commit', '-q', '-m', `atelier create ${name}`, ...(fresh ? [] : ['--', ...paths])]);
  if (c.code !== 0) fail(`git commit failed: ${c.err}`, 1);
}

// the remote atelier, to your own computer, when signed in
const host = resolveHost(opts.host);
const entry = sessionFor(readCredentials(), host);
const later = `project ${name} · ${notSignedIn(host)}, then atelier remote <computer>`;
if (!entry) { console.log(later); process.exit(0); }
const r = await askHost(host, 'GET', COMPUTERS_PATH, { session: entry.session });
if (r.status === 401) { console.log(later); process.exit(0); }
if (r.status === 0) { console.log(`project ${name} · ${unreachable(host)}: atelier remote <computer> later`); process.exit(0); }
const own = r.status === 200 && Array.isArray(r.body.computers) ? r.body.computers.find((c) => c && c.kind === 'own' && c.label) : null;
if (!own) { console.log(`project ${name} · no computer of your own at ${host}: atelier remote <computer>`); process.exit(0); }
setRemote(dir, DEFAULT_REMOTE, remoteUrl(host, own.label, label), fail);
console.log(`project ${name} · in your space · remote "${DEFAULT_REMOTE}" set`);
