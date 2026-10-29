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
 * POST /api/ops/<id>/in { values }), never in the op the host records. The
 * computer keeps them for the app (never in git, never in the app's home);
 * the host's record keeps the names only. Inside a sandbox, an agent's hand,
 * `set` is refused here before any op: a value never passes through an agent.
 */
import { failer, whereOf, runOp, exitOf, inSandbox } from './ops.js';
import { readArgs, helpOf, REMOTE } from './args.js';
import { CONFIG_KEY, CONFIG_VALUE_CHARS } from './limits.js';

/** Why a sandbox's `set` goes nowhere: the same sentence the computer answers an agent's hand with. */
export const VALUES_ON_THE_PORTAL = 'a secret\'s value is set on the portal by the person who looks after the app, never typed to an agent';

const SPEC = {
  usage: 'atelier config [set KEY=value… | unset KEY…] [-r remote]',
  words: [['KEY', `A-Z, digits and _ (CRM_MAIL_HOST); a value at most ${CONFIG_VALUE_CHARS} characters`]],
  options: [REMOTE],
  most: Infinity,
};
const USAGE = helpOf(SPEC);
const fail = failer('config');
const { opts, words: args } = readArgs(process.argv.slice(2), SPEC, fail);
let set = [], unset = [];
const values = {};
if (args[0] === 'set') {
  if (args.length < 2) fail(`set what? KEY=value\n\n${USAGE}`);
  for (const a of args.slice(1)) {
    const i = a.indexOf('=');
    const k = i > 0 ? a.slice(0, i) : '';
    if (!CONFIG_KEY.test(k)) fail(`"${i > 0 ? k : a}" is not KEY=value\n\n${USAGE}`);
    values[k] = a.slice(i + 1);
    if (!set.includes(k)) set.push(k);
  }
} else if (args[0] === 'unset') {
  if (args.length < 2) fail(`unset what? KEY\n\n${USAGE}`);
  for (const k of args.slice(1)) { if (!CONFIG_KEY.test(k)) fail(`"${k}" is not a KEY\n\n${USAGE}`); if (!unset.includes(k)) unset.push(k); }
} else if (args.length) fail(`unknown: ${args[0]}\n\n${USAGE}`);
if (set.length && inSandbox()) fail(VALUES_ON_THE_PORTAL, 1);
const where = whereOf(opts.remote ?? null, fail, 'config');
const code = await runOp('config', where, { verb: 'config', ...(set.length ? { set } : {}), ...(unset.length ? { unset } : {}) }, {
  during: set.length ? (into) => into({ values }) : undefined,
});
process.exit(exitOf(code));
