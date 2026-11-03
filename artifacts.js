#!/usr/bin/env node
/* atelier artifacts adopt — the artifacts moved onto a computer's drive become its chat's artifacts: every version in
 * its order, published as the chat's persona with a link of its own, and a second run says `already`. The drive side is
 * written computer:/path: the folder that holds them (each version a <token>/~<n>/) beside their rows (artifacts.json).
 *
 *   atelier artifacts adopt <computer>:/<path>
 *
 *   remote: Trip plan · 3 versions · https://<host>/artifacts/<token>
 *   remote: done · 1 adopted · 0 already
 *
 * Through the host with your session (ops.js), on files write on that computer, as files push. A machine's verb.
 */
import { failer, runOp, exitOf, inSandbox } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';

const SPEC = { usage: 'atelier artifacts adopt <computer>:/<path>', words: [['<computer>', 'one of atelier computers; <path> inside its files/']], options: [HOST], most: 1 };
const USAGE = helpOf(SPEC);
const fail = failer('artifacts');
const argv = process.argv.slice(2);
const sub = argv[0] === 'adopt' ? argv.shift() : null;
const named = argv[0]?.startsWith('-') ? undefined : argv[0];
const which = () => fail(`artifacts ${named ?? 'what'}? adopt\n\n${USAGE}`);
if (!sub && named) which();
const { opts, words } = readArgs(argv, { ...SPEC, sub }, fail);
if (!sub) which();
if (inSandbox()) fail('inside a sandbox the drive is its files/: artifacts adopt is a machine\'s', 1);
if (words.length !== 1) fail(`adopt takes <computer>:/<path>\n\n${USAGE}`);
const drive = /^([A-Za-z0-9_.-]+):(\/.*)?$/.exec(words[0]);
if (!drive) fail(`"${words[0]}" is not computer:/path\n\n${USAGE}`);
const path = (drive[2] || '/').replace(/^\/+/, '');
if (path.split('/').includes('..')) fail('the path stays inside the drive');
process.exit(exitOf(await runOp('artifacts', { host: resolveHost(opts.host), computer: drive[1] }, { verb: 'artifacts-adopt', path })));
