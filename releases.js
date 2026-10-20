#!/usr/bin/env node
/* atelier releases — what was live and when: the commit, who pushed it, from
 * which machine or chat. It is the app's deployed history, read from the
 * host's record.
 *
 *   atelier releases [-r remote]
 *
 *   9c04e1f · 2026-10-06 14:05 · by Alex · from a laptop · live
 *   81d07e4 · 2026-10-05 09:20 · by agent · from k1/main
 *
 * In a module folder; the remote (default atelier) says the host, the computer
 * and the app. The host answers GET /api/releases?computer=&module= with
 * { releases: [{ commit, at, by, from, live, op?, what? }] }; shown newest
 * first. An entry with `op` is not a push but a config change, a data push or a
 * restart from the same record, its words in `what`, its commit the one live
 * then:
 *
 *   9c04e1f · 2026-10-07 14:20 · config 2 keys set · by Alex · from a laptop
 *
 * Exit 0 done · 1 the host cannot be reached or refused · 2 written wrongly,
 * outside a module folder, or no such remote · 3 not signed in at the remote's
 * host · 4 the grant is missing (maintain).
 */
import { askHost, hostAnswer, grantMissing, localTime } from './session.js';
import { DEFAULT_REMOTE } from './repo.js';
import { failer, sessionAt, whereOf } from './ops.js';
import { SHORT_SHA_CHARS } from './limits.js';
import { readArgs, REMOTE } from './args.js';

const fail = failer('releases');
const { opts } = readArgs(process.argv.slice(2), { usage: 'atelier releases [-r remote]',
  options: [{ ...REMOTE, help: `a git remote of this module (default: ${DEFAULT_REMOTE})` }] }, fail);
const { host, computer, module } = whereOf(opts.remote ?? DEFAULT_REMOTE, fail, 'releases');

const q = new URLSearchParams({ computer, module });
const answer = hostAnswer(await askHost(host, 'GET', `/api/releases?${q}`, { session: sessionAt(host, fail).session }), host, fail,
  { missing: grantMissing(computer) });

// a push names its commit; an entry that is not a push (a restart, a config change, a data push) names its words
const list = (Array.isArray(answer.releases) ? answer.releases : []).filter((x) => x && (x.commit || typeof x.op === 'string'))
  .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
if (!list.length) { console.log(`\n  ${module} on ${computer}: nothing pushed yet\n`); process.exit(0); }
console.log('');
for (const x of list) {
  if (typeof x.op === 'string') console.log(`  ${(x.commit ? String(x.commit).slice(0, SHORT_SHA_CHARS) : '').padEnd(SHORT_SHA_CHARS)} · ${localTime(x.at)} · ${x.what || x.op} · by ${x.by ?? '?'}${x.from ? ` · from ${x.from}` : ''}`);
  else console.log(`  ${String(x.commit).slice(0, SHORT_SHA_CHARS)} · ${localTime(x.at)} · by ${x.by ?? '?'}${x.from ? ` · from ${x.from}` : ''}${x.live ? ' · live' : ''}`);
}
console.log('');
