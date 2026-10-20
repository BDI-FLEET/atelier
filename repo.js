/* atelier · the module's repository, shared by the verbs that say where an app
 * lives (create, remote, push, releases).
 *
 * A remote is an ordinary git remote on the module's own repository: git
 * remote -v shows where an app lives. The remote's URL is the receiver's:
 *
 *   <host>/git/<computer>/<module>.git
 *
 * so the URL alone says which host, which computer and which app. No other state is kept: the session is the one in
 * ~/.config/atelier/credentials for that host.
 *
 * The app's name in a remote is its label, the way the host names it
 * (appLabel): module.json's `name`, lower case, every run of other characters
 * a dash, at most 40; the folder's name when module.json gives none.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalHost, askHost, hostAnswer } from './session.js';
import { MODULE_JSON } from './module-json.js';
import { APP_LABEL_CHARS } from './limits.js';

export const DEFAULT_REMOTE = 'atelier';

/* What a module's repository never carries: its data and its dependencies. */
export const GITIGNORE = 'data/\nnode_modules/\n';

/* The host's label for an app, with the folder's name in its place when module.json gives no name. */
export function appLabel(name, fallback = '') {
  const l = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, APP_LABEL_CHARS).replace(/-+$/, '');
  return l || String(fallback).toLowerCase();
}

/* git in a folder; { code, out, err }. Never a shell. */
export function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  return { code: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/* The module folder this command runs in: a git repository whose top holds a module.json. null outside of one. */
export function moduleHere(cwd = process.cwd()) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0 || !top.out) return null;
  const dir = top.out;
  let declared;
  try { declared = JSON.parse(fs.readFileSync(path.join(dir, MODULE_JSON), 'utf8')); } catch { return null; }
  const name = declared && typeof declared.name === 'string' ? declared.name : '';
  return { dir, name: appLabel(name, path.basename(dir)) };
}

/* A remote's URL: <host>/git/<computer>/<module>.git. */
export const remoteUrl = (host, computer, module) => `${normalHost(host)}/git/${computer}/${module}.git`;

/* What a remote's URL says: the host, the computer, the app. null for a URL that is not a receiver's. */
export function parseRemote(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const m = /^(.*)\/git\/([^/]+)\/([^/]+)\.git\/?$/.exec(u.pathname);
  if (!m) return null;
  return { host: normalHost(u.origin + m[1]), computer: decodeURIComponent(m[2]), module: decodeURIComponent(m[3]) };
}

export const NOT_A_MODULE_FOLDER = 'not in a module folder: a git repository with a module.json (atelier create makes one)';

/* The URL of a named remote on the module's repository, or null. */
export function remoteOf(dir, name) {
  const r = git(dir, ['remote', 'get-url', name]);
  return r.code === 0 && r.out ? r.out : null;
}

/* Add the remote, or point it elsewhere when it exists; the verb fails when git cannot. */
export function setRemote(dir, name, url, fail) {
  const had = remoteOf(dir, name) !== null;
  if (git(dir, had ? ['remote', 'set-url', name, url] : ['remote', 'add', name, url]).code !== 0) fail(`git could not set the remote "${name}"`, 1);
}

/* A token from the host for one `op` (clone or push) of one app, on your session, and the http(s) address to use it at:
 * { url, token }. The host checks the maintain grant here and again at each request git makes. */
export async function gitToken(op, host, session, { computer, module }, fail, missing) {
  const t = hostAnswer(await askHost(host, 'POST', `/api/${op}/token`, { body: { computer, module }, session }), host, fail,
    { ok: 201, missing, otherwise: `the host at ${host} gave no ${op} token` });
  if (typeof t.token !== 'string' || typeof t.url !== 'string') fail(`the host at ${host} gave no ${op} token`, 1);
  let url;
  try {
    url = new URL(t.url);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    // no user in the URL: git then asks the helper for both, `atelier` and the token (with `atelier@` in the URL git
    // sends an empty password and never asks)
    url.username = '';
    url.password = '';
  } catch { fail(`the host at ${host} gave a ${op} address that is not http(s)`, 1); }
  return { url: url.href, token: t.token };
}

/*
 * git <op> over HTTP to `url` as user `atelier` with `token` as the password. The token reaches git through a one-off
 * GIT_ASKPASS helper that holds no token: a 0700 script in a 0700 temp folder printing $ATELIER_GIT_TOKEN, a variable
 * of the git process only; the folder is deleted when git ends. `-c credential.helper=` empties the helper list so the
 * token never lands in a credential store, and GIT_TERMINAL_PROMPT=0 so a refused token never prompts. The token is
 * never in argv, a file that outlives git, the repository's config or the output.
 * `flags` go before the URL, `after` behind it. git's output passes through unchanged; `onStderr` sees what it wrote
 * there. Answers git's exit code.
 */
export async function gitWithToken(op, url, token, { flags = [], after = [], cwd, onStderr } = {}, fail) {
  const helperDir = fs.mkdtempSync(path.join(os.tmpdir(), `atelier-${op}-`));
  fs.chmodSync(helperDir, 0o700);
  const helper = path.join(helperDir, 'askpass');
  fs.writeFileSync(helper, '#!/bin/sh\ncase "$1" in Username*) echo atelier ;; *) printf \'%s\\n\' "$ATELIER_GIT_TOKEN" ;; esac\n', { mode: 0o700 });
  fs.chmodSync(helper, 0o700);

  const child = spawn('git', ['-c', 'credential.helper=', op, ...flags, url, ...after], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_ASKPASS: helper, ATELIER_GIT_TOKEN: token, GIT_TERMINAL_PROMPT: '0' },
  });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { child.kill(sig); });
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => { process.stderr.write(d); onStderr?.(d.toString('utf8')); });
  const code = await new Promise((done) => { child.on('error', () => done(-1)); child.on('close', (c) => done(c ?? 1)); });
  try { fs.rmSync(helperDir, { recursive: true, force: true }); } catch {}
  if (code === -1) fail('git could not be started', 1);
  return code;
}
