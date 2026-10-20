#!/usr/bin/env node
/* atelier remote — points this module at an app in an existing computer you
 * may maintain. The app's name is the folder's. The remote is called atelier
 * unless --name says otherwise, which is how a second environment is added. It
 * is a plain git remote; git remote remove undoes it.
 *
 *   atelier remote <computer> [--name <remote>] [--host <url>]
 *
 *   remote → alex-sam · workspaces: main
 *
 * Inside a module folder (a git repository with a module.json). The computer
 * is one from `atelier computers`; the remote's URL is the receiver's,
 * <host>/git/<computer>/<module>.git, and the app's name is module.json's
 * name as the host labels it, else the folder's. Nothing is pushed.
 *
 * Exit 0 done · 1 the host cannot be reached or refused · 2 written wrongly
 * or outside a module folder · 3 not signed in on that host · 4 the computer is
 * not one you hold a grant on.
 */
import { resolveHost, askHost, hostAnswer, COMPUTERS_PATH } from './session.js';
import { DEFAULT_REMOTE, moduleHere, remoteUrl, setRemote } from './repo.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';

const NAME = /^[A-Za-z0-9_.-]+$/;
const SPEC = {
  usage: 'atelier remote <computer> [--name <remote>] [--host <url>]',
  words: [['<computer>', 'one of atelier computers']],
  options: [
    { flag: '--name', value: 'remote', help: `the remote's name (default: ${DEFAULT_REMOTE}); a second name is a second environment`, check: (n) => NAME.test(n) || `"${n}" isn't a remote's name` },
    HOST,
  ],
  most: 1,
};
const fail = failer('remote');

const { opts, words: [computer] } = readArgs(process.argv.slice(2), SPEC, fail);
const name = opts.name ?? DEFAULT_REMOTE;
if (!computer) fail(`which computer? atelier computers lists them\n\n${helpOf(SPEC)}`);
if (!NAME.test(computer)) fail(`"${computer}" isn't a computer's name\n\n${helpOf(SPEC)}`);

const mod = moduleHere();
if (!mod) fail('not in a module folder: a git repository with a module.json (atelier create makes one)');

const host = resolveHost(opts.host);
const { session } = sessionAt(host, fail);
const listed = hostAnswer(await askHost(host, 'GET', COMPUTERS_PATH, { session }), host, fail);
const found = (Array.isArray(listed.computers) ? listed.computers : []).find((c) => c && c.label === computer);
// the same answer for a computer that is not yours and one that does not exist
if (!found) fail(`the grant is missing: maintain on ${computer}`, 4);

if (!setRemote(mod.dir, name, remoteUrl(host, computer, mod.name))) fail(`git could not set the remote "${name}"`, 1);
const ws = Array.isArray(found.workspaces) && found.workspaces.length ? found.workspaces.map((w) => w?.name ?? w).join(', ') : 'main';
console.log(`remote${name === DEFAULT_REMOTE ? '' : ` "${name}"`} → ${computer} · workspaces: ${ws}`);
