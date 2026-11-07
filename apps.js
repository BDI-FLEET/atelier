#!/usr/bin/env node
/* atelier apps adopt — the apps moved onto a computer's drive become that computer's apps: each folder holding a
 * module.json pushed and released as the chat's own agent would push it, a second run says `already`, and an app that
 * cannot be says why (`not mounted: <why>`). The drive side is written computer:/path: the folder that holds them, a
 * folder an app.
 *
 *   atelier apps adopt <computer>:/<path>
 *
 *   remote: notes · live @ <commit> · <link>
 *   remote: done · 1 mounted · 0 already · 0 not mounted
 *
 * Through the host with your session (ops.js), on files write on that computer, as files push. A machine's verb.
 */
import { failer, runOp, exitOf, inSandbox } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';

const SPEC = { usage: 'atelier apps adopt <computer>:/<path>', words: [['<computer>', 'one of atelier computers; <path> inside its files/']], options: [HOST], most: 1 };
const USAGE = helpOf(SPEC);
const fail = failer('apps');
const argv = process.argv.slice(2);
const sub = argv[0] === 'adopt' ? argv.shift() : null;
const named = argv[0]?.startsWith('-') ? undefined : argv[0];
const which = () => fail(`apps ${named ?? 'what'}? adopt\n\n${USAGE}`);
if (!sub && named) which();
const { opts, words } = readArgs(argv, { ...SPEC, sub }, fail);
if (!sub) which();
if (inSandbox()) fail('inside a sandbox the drive is its files/: apps adopt is a machine\'s', 1);
if (words.length !== 1) fail(`adopt takes <computer>:/<path>\n\n${USAGE}`);
const drive = /^([A-Za-z0-9_.-]+):(\/.*)?$/.exec(words[0]);
if (!drive) fail(`"${words[0]}" is not computer:/path\n\n${USAGE}`);
const path = (drive[2] || '/').replace(/^\/+/, '');
if (path.split('/').includes('..')) fail('the path stays inside the drive');
process.exit(exitOf(await runOp('apps', { host: resolveHost(opts.host), computer: drive[1] }, { verb: 'apps-adopt', path })));
