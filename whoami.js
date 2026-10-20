#!/usr/bin/env node
/* atelier whoami — who this machine acts as, on which host.
 *
 *   atelier whoami [--grants] [--sessions] [--host <url>]
 *
 *   acting as Alex · at http://127.0.0.1:4350
 *
 * --grants adds what you may do, in words, one line each: the grants the host
 * holds for you, never anybody else's.
 * --sessions adds every machine signed in as you there, each with until when,
 * this one marked; never a session itself. Sign this one out with `atelier logout`.
 *
 * Exit 0 done · 1 the host cannot be reached or refused · 2 written wrongly ·
 * 3 not signed in on that host.
 */
import { resolveHost, askHost, hostAnswer } from './session.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, HOST } from './args.js';

const fail = failer('whoami');
const { opts: { grants, sessions, host: flagHost } } = readArgs(process.argv.slice(2), {
  usage: 'atelier whoami [--grants] [--sessions] [--host <url>]',
  options: [{ flag: '--grants', help: 'what you may do, in words' }, { flag: '--sessions', help: 'every machine signed in as you, until when' }, HOST],
}, fail);

const host = resolveHost(flagHost);
const me = hostAnswer(await askHost(host, 'GET', '/api/whoami', { session: sessionAt(host, fail).session }), host, fail);

const person = me.person || {};
console.log(`\n  acting as ${person.name ?? person.id ?? '?'} · at ${host}`);
if (grants) {
  const lines = Array.isArray(me.grants) ? me.grants : [];
  for (const g of lines) console.log(`    ${inWords(g)}`);
  if (!lines.length) console.log('    nothing granted');
}
if (sessions) {
  const all = Array.isArray(me.sessions) ? me.sessions : [];
  console.log(`  signed in on ${all.length} ${all.length === 1 ? 'machine' : 'machines'}:`);
  const until = (e) => e ? `until ${String(e).slice(0, 16).replace('T', ' ')} UTC` : 'no end';
  for (const s of [...all].sort((a, b) => (b.this === true) - (a.this === true))) console.log(`    ${s.this ? 'this machine' : 'another machine'} · ${until(s.expires)}`);
}
console.log('');

/* One grant line in words: `chat:c2d8e1#member@person:7f3a2c` → `a member of chat:c2d8e1`. The subject is you. */
function inWords(line) {
  const m = /^([a-z]+):([^#@]+)#([a-z]+)@/.exec(String(line));
  if (!m) return String(line);
  const [, kind, token, relation] = m, object = `${kind}:${token}`;
  switch (relation) {
    case 'member': return `a member of ${object}`;
    case 'of': return `signed in on a machine (a session, ${token.slice(0, 8)}…)`;
    case 'watch': return `may watch ${object}`;
    case 'read': return `may read ${object}`;
    case 'write': return `may write ${object}`;
    case 'use': return `may use ${object}`;
    case 'ask': return `may ask ${object}`;
    case 'maintain': return `maintains ${object}`;
    default: return `${relation} · ${object}`;
  }
}
