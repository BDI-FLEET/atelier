/* atelier · the session with a host, shared by the identity verbs (login /
 * whoami / logout).
 *
 * The CLI knows a host only through its HTTP API. Signing in ends in a
 * session — the same kind the browser holds — kept in one file:
 *
 *   $XDG_CONFIG_HOME/atelier/credentials, else ~/.config/atelier/credentials   (mode 0600, directory 0700)
 *   {
 *     "<host>": { session, expires, person: { id, name }, network, number }
 *   }
 *
 * One entry per host, readable by you alone; the network and the number are
 * kept for the next login.
 * Nothing else is stored. The session value is never printed.
 *
 * Which host: there is one default host, and --host signs in to another one:
 * --host <url> for that call, else ATELIER_HOST (how a machine names its
 * default host), else DEFAULT_HOST (the default host in dev).
 * Signing in somewhere else never moves the default.
 *
 * Kept free of packages (node builtins, global fetch and limits.js) and apart from the
 * server: nothing here runs in the serving process.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEV_HOST_PORT } from './limits.js';

export const DEFAULT_HOST = `http://127.0.0.1:${DEV_HOST_PORT}`;

/* The host's list of the computers a person is in. */
export const COMPUTERS_PATH = '/api/computers';

const home = () => process.env.HOME || os.homedir();
const configHome = () => (path.isAbsolute(process.env.XDG_CONFIG_HOME || '') ? process.env.XDG_CONFIG_HOME : path.join(home(), '.config'));
export const credentialsDir = () => path.join(configHome(), 'atelier');
export const credentialsPath = () => path.join(credentialsDir(), 'credentials');

/* "http://x:1/" and "http://x:1" are one host. */
export const normalHost = (h) => String(h).trim().replace(/\/+$/, '');

export function readCredentials() {
  try {
    const c = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch { return {}; }
}

/* Written whole, through a 0600 temp file renamed into place: the file is
 * never readable by anyone else, not even for a moment. */
export function writeCredentials(creds) {
  const dir = credentialsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const file = credentialsPath();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function resolveHost(flagHost) {
  return normalHost(flagHost || process.env.ATELIER_HOST || DEFAULT_HOST);
}

/* One call to the host's API. Answers { status, body }; a host that cannot
 * be reached answers { status: 0 }. */
export async function askHost(host, method, route, { body, session } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.authorization = `Session ${session}`;
  let res;
  try {
    res = await fetch(host + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { status: 0, body: {} };
  }
  let parsed = {};
  try { parsed = await res.json(); } catch {}
  return { status: res.status, body: parsed && typeof parsed === 'object' ? parsed : {} };
}

/* A refusal's sentence: the receiver contract says { error }, the host's other routes { refused }. */
export const sentenceOf = (r, fallback) =>
  (typeof r.body.error === 'string' && r.body.error) || (typeof r.body.refused === 'string' && r.body.refused) || fallback;

export const unreachable = (host) => `the host at ${host} cannot be reached`;

/* Not signed in at a host; with `hint`, the verb that signs in there. */
export const notSignedIn = (host, { hint = true } = {}) =>
  `not signed in at ${host}${hint ? ` · atelier login${host === resolveHost() ? '' : ` --host ${host}`}` : ''}`;

/* A status the verb did not expect from the host. */
export const hostAnswered = (host, status) => `the host at ${host} answered ${status}`;

export const GRANT_MISSING = 'the grant is missing';

/* The grant a verb needs on `where` is not the person's. */
export const grantMissing = (where) => `${GRANT_MISSING}: maintain on ${where}`;

/* The exit a refusal gives by its status, the host's or a computer's on the socket: 2 written wrongly, 3 not signed in,
 * 4 the grant is missing, any other refusal 1. */
const REFUSAL_EXITS = Object.freeze({ 400: 2, 401: 3, 403: 4 });
export const exitOfRefusal = (status) => REFUSAL_EXITS[status] ?? 1;

/* The host's answer, when it is the one asked for (status `ok`); else the verb fails, as every verb does, its exit
 * from the status (1 when the host cannot be reached) and the host's sentence (`missing` for a 403 that gives none). */
export function hostAnswer(r, host, fail, { ok = 200, missing = GRANT_MISSING, otherwise } = {}) {
  if (r.status === 0) fail(unreachable(host), 1);
  if (r.status === 401) fail(notSignedIn(host), exitOfRefusal(r.status));
  const fallback = r.status === 403 ? missing : r.status === 400 ? 'written wrongly' : otherwise ?? hostAnswered(host, r.status);
  if (r.status !== ok) fail(sentenceOf(r, fallback), exitOfRefusal(r.status));
  return r.body;
}

/* The stored entry for a host when it holds a session, or null. */
export function sessionFor(creds, host) {
  const e = creds[host] && typeof creds[host] === 'object' ? creds[host] : null;
  return e?.session ? e : null;
}

/* The session a host answered with, kept for that host. The file is read again first (another login may have landed
 * meanwhile); the network and the number stored for the host stay unless `extra` names others. */
export function keepSession(host, { session, expires, person = {} }, extra = {}) {
  const creds = readCredentials();
  const kept = creds[host] && typeof creds[host] === 'object' ? creds[host] : {};
  creds[host] = { session, expires, person: { id: person.id, name: person.name },
    ...(kept.network ? { network: kept.network } : {}), ...(kept.number ? { number: kept.number } : {}), ...extra };
  writeCredentials(creds);
}

/* expires (ISO string or epoch ms) → "2026-10-01 14:05", local time. */
export function localTime(expires) {
  const d = new Date(typeof expires === 'string' && /^\d+$/.test(expires) ? Number(expires) : expires);
  if (Number.isNaN(d.getTime())) return String(expires);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
