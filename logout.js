#!/usr/bin/env node
/* atelier logout — sign out of a host.
 *
 *   atelier logout [--host <url>]
 *
 * Tells the host to end the session, and forgets it on this machine. If the
 * host cannot be reached the session is still forgotten here; on the host
 * it ends at its expiry.
 */
import { readCredentials, writeCredentials, resolveHost, askHost, sessionFor, unreachable } from './session.js';
import { failer } from './ops.js';
import { readArgs, HOST } from './args.js';

const { opts } = readArgs(process.argv.slice(2), { usage: 'atelier logout [--host <url>]', options: [HOST] }, failer('logout'));

const creds = readCredentials();
const host = resolveHost(opts.host);
if (!creds[host]) { console.log(`\n  not signed in at ${host}\n`); process.exit(0); }

const entry = sessionFor(creds, host);
const gone = entry ? (await askHost(host, 'POST', '/api/logout', { session: entry.session })).status === 0 : false;

delete creds[host];
writeCredentials(creds);

if (gone) console.log(`\n  ${unreachable(host)} · the session there ends at its expiry`);
console.log(`\n  signed out of ${host}\n`);
