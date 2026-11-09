#!/usr/bin/env node
/* atelier memory adopt — what an agent kept between its sessions where it ran before becomes what the chat's agent on
 * that computer keeps: the folders memory/, rules/ and skills/ moved onto the drive, placed where its harness reads them,
 * beside what it wrote there; a second run says `already`. The drive side is written computer:/path: the folder that
 * holds the three.
 *
 *   atelier memory adopt <computer>:/<path>
 *
 *   remote: memory · 45 placed · 0 joined · 0 beside · 0 already · 0 not adopted
 *   remote: done · 45 placed · 0 already
 *
 * Through the host with your session (ops.js), on files write on that computer, as files push. A machine's verb.
 */
import { failer, runOp, exitOf, inSandbox } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';

const SPEC = { usage: 'atelier memory adopt <computer>:/<path>', words: [['<computer>', 'one of atelier computers; <path> inside its files/']], options: [HOST], most: 1 };
const USAGE = helpOf(SPEC);
const fail = failer('memory');
const argv = process.argv.slice(2);
const sub = argv[0] === 'adopt' ? argv.shift() : null;
const named = argv[0]?.startsWith('-') ? undefined : argv[0];
const which = () => fail(`memory ${named ?? 'what'}? adopt\n\n${USAGE}`);
if (!sub && named) which();
const { opts, words } = readArgs(argv, { ...SPEC, sub }, fail);
if (!sub) which();
if (inSandbox()) fail('inside a sandbox the drive is its files/: memory adopt is a machine\'s', 1);
if (words.length !== 1) fail(`adopt takes <computer>:/<path>\n\n${USAGE}`);
const drive = /^([A-Za-z0-9_.-]+):(\/.*)?$/.exec(words[0]);
if (!drive) fail(`"${words[0]}" is not computer:/path\n\n${USAGE}`);
const path = (drive[2] || '/').replace(/^\/+/, '');
if (path.split('/').includes('..')) fail('the path stays inside the drive');
process.exit(exitOf(await runOp('memory', { host: resolveHost(opts.host), computer: drive[1] }, { verb: 'memory-adopt', path })));
