#!/usr/bin/env node
/* atelier computers — the computers you hold a grant on: the list to pick from
 * for remote and for the computer: part of a files path.
 *
 *   atelier computers [--host <url>]
 *
 *   alex-sam     your chat with Sam · 2 modules
 *   alex         your own · 1 module
 *   example-co   shared with your team
 *
 * The host answers GET /api/computers with { computers: [{ id, label, kind,
 * line, modules }] }: the label is the word used in remotes, the line the
 * host's sentence for what the computer is to you, modules how many apps run
 * on it (no count when none).
 *
 * Exit 0 done · 1 the host cannot be reached or refused · 2 written wrongly ·
 * 3 not signed in on that host.
 */
import { resolveHost, askHost, hostAnswer, COMPUTERS_PATH } from './session.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, HOST } from './args.js';

const fail = failer('computers');
const { opts } = readArgs(process.argv.slice(2), { usage: 'atelier computers [--host <url>]', options: [HOST] }, fail);

const host = resolveHost(opts.host);
const listed = hostAnswer(await askHost(host, 'GET', COMPUTERS_PATH, { session: sessionAt(host, fail).session }), host, fail);

const list = (Array.isArray(listed.computers) ? listed.computers : []).filter((c) => c && c.label);
if (!list.length) { console.log('\n  no computers yet\n'); process.exit(0); }
const width = Math.max(...list.map((c) => String(c.label).length)) + 3;
console.log('');
for (const c of list) {
  const n = Array.isArray(c.modules) ? c.modules.length : Number(c.modules) || 0;
  const count = n ? ` · ${n} module${n === 1 ? '' : 's'}` : '';
  console.log(`  ${String(c.label).padEnd(width)}${c.line || c.kind || ''}${count}`);
}
console.log('');
