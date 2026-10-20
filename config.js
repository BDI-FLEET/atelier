#!/usr/bin/env node
/* atelier config — the app's settings and secrets: a mail host, an API key.
 * The backend receives them as environment variables. Without arguments it
 * lists the keys, each with when it was set and by whom. Values are never
 * shown, not to anyone, not even to who set them. set and unset change keys,
 * restart the backend so it sees them, and leave an entry in releases.
 *
 *   atelier config [set KEY=value… | unset KEY…] [-r remote]
 *
 *   remote: 2 keys set · notes restarted
 *   CRM_MAIL_HOST   set 7 Oct 09:41 by Alex
 *
 * The op names the keys; the values go into it once it runs (on a laptop
 * POST /api/ops/<id>/in { values }, in a sandbox the socket's request), never
 * in the op the host records. The computer keeps them for the app (never in
 * git, never in the app's home); the host's record keeps the names only.
 */
import { failer, whereOf, runOp, exitOf } from './ops.js';
import { readArgs, helpOf, REMOTE } from './args.js';

const SPEC = {
  usage: 'atelier config [set KEY=value… | unset KEY…] [-r remote]',
  words: [['KEY', 'A-Z, digits and _ (CRM_MAIL_HOST); a value at most 4096 characters']],
  options: [REMOTE],
  most: Infinity,
};
const USAGE = helpOf(SPEC);
const fail = failer('config');
const { opts, words: args } = readArgs(process.argv.slice(2), SPEC, fail);
const KEY = /^[A-Z_][A-Z0-9_]{0,63}$/;
let set = [], unset = [];
const values = {};
if (args[0] === 'set') {
  if (args.length < 2) fail(`set what? KEY=value\n\n${USAGE}`);
  for (const a of args.slice(1)) {
    const i = a.indexOf('=');
    const k = i > 0 ? a.slice(0, i) : '';
    if (!KEY.test(k)) fail(`"${i > 0 ? k : a}" is not KEY=value\n\n${USAGE}`);
    values[k] = a.slice(i + 1);
    if (!set.includes(k)) set.push(k);
  }
} else if (args[0] === 'unset') {
  if (args.length < 2) fail(`unset what? KEY\n\n${USAGE}`);
  for (const k of args.slice(1)) { if (!KEY.test(k)) fail(`"${k}" is not a KEY\n\n${USAGE}`); if (!unset.includes(k)) unset.push(k); }
} else if (args.length) fail(`unknown: ${args[0]}\n\n${USAGE}`);
const where = whereOf(opts.remote ?? null, fail, 'config');
const code = await runOp('config', where, { verb: 'config', ...(set.length ? { set } : {}), ...(unset.length ? { unset } : {}) }, {
  during: set.length ? (into) => into({ values }) : undefined,
  socket: set.length ? { values } : undefined,
});
process.exit(exitOf(code));
