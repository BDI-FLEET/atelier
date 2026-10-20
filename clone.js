#!/usr/bin/env node
/* atelier clone — a maintainer gets an app's code from the host's git, never
 * its data.
 *
 *   atelier clone <app> [folder] [--computer <label>] [--host <url>]
 *
 *   cloned reading-list at 9c04e1f · remote atelier → alex-sam
 *
 * For a signed-in person who may push the app (the maintain grant, the same
 * right a push needs, read instead of written). `atelier files pull
 * computer:/apps/<app>` copies the live folder with its data/ inside: the
 * owner's way, wrong for a maintainer. This one reads the app's repository,
 * what was pushed, and nothing else.
 *
 * 1 · the computer the app runs on: found among `atelier computers` by the
 *     app's label (--computer names one when two of yours run an app of that
 *     name); none of yours runs it: the grant is missing, the same answer for
 *     an app that is not there and one that is not yours;
 * 2 · the host mints a clone token for that app
 *     (POST /api/clone/token { computer, module }, your session), answering
 *     the address of the host's git; the host checks the maintain grant there
 *     and again at each request of the clone;
 * 3 · git clones there with the token, the way push hands it (repo.js
 *     gitWithToken): never in argv, a file that outlives git, the
 *     repository's config or the output;
 * 4 · the remote is called atelier and points at that computer, as `atelier
 *     remote` sets it (<host>/git/<computer>/<app>.git), so `atelier push`
 *     from the folder pushes back; a repository without a .gitignore gets one
 *     with data/ and node_modules/, as `atelier create` writes it (left for
 *     you to commit).
 *
 * Inside a sandbox there is no session: the agent's clone tool clones, the
 * computer holding the token.
 *
 * Exit 0 cloned · 1 the host cannot be reached, or git failed · 2 written
 * wrongly, the folder exists, or two computers run that app · 3 not signed in
 * at that host · 4 the grant is missing (the host's sentence names it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveHost, askHost, hostAnswer } from './session.js';
import { inSandbox } from './sandbox.js';
import { DEFAULT_REMOTE, GITIGNORE, git, gitToken, gitWithToken, remoteUrl, setRemote } from './repo.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';

const LABEL = /^[A-Za-z0-9_.-]{1,80}$/;
const SPEC = {
  usage: 'atelier clone <app> [folder] [--computer <label>] [--host <url>]',
  words: [['<app>', 'an app you may push (atelier computers lists them)'], ['folder', "where its code goes (default: the app's name)"]],
  options: [
    { flag: '--computer', value: 'label', help: 'the computer it runs on, when two of yours run an app of that name', check: (c) => LABEL.test(c) || `"${c}" isn't a computer's label` },
    HOST,
  ],
  most: 2,
};
const fail = failer('clone');

const { opts, words: [app, folder = app] } = readArgs(process.argv.slice(2), SPEC, fail);
if (!app) fail(`which app? atelier computers lists them\n\n${helpOf(SPEC)}`);
if (!LABEL.test(app)) fail(`"${app}" isn't an app's name\n\n${helpOf(SPEC)}`);
if (inSandbox()) fail('inside a sandbox the clone tool clones an app: the computer holds the token');

// the folder first: nothing is asked of the host for a clone that cannot land
const dir = path.resolve(folder);
if (fs.existsSync(dir) && !(fs.statSync(dir).isDirectory() && fs.readdirSync(dir).length === 0)) fail(`${folder}/ exists already`);

const host = resolveHost(opts.host);
const { session } = sessionAt(host, fail);

// 1 · the computer the app runs on, among yours
const missing = `the grant is missing: maintain on ${app}`;
const listed = hostAnswer(await askHost(host, 'GET', '/api/computers', { session }), host, fail, { missing });
const runs = (c) => Array.isArray(c?.modules) && c.modules.some((m) => m && m.label === app);
let found = (Array.isArray(listed.computers) ? listed.computers : []).filter((c) => c && typeof c.label === 'string' && (!opts.computer || c.label === opts.computer) && runs(c));
// two of yours run an app of that name: the one you maintain, else name it (the host decides the right, not this list)
if (found.length > 1) {
  const yours = found.filter((c) => c.modules.some((m) => m && m.label === app && m.maintain === true));
  if (yours.length === 1) found = yours;
  else fail(`${app} runs on more than one of your computers (${found.map((c) => c.label).join(', ')}): atelier clone ${app} --computer <label>`);
}
// the same answer for an app that is not there and one that is not yours
if (!found.length) fail(missing, 4);
const computer = found[0].label;

// 2 · a token for this clone; 3 · git clones with it
const { url, token } = await gitToken('clone', host, session, { computer, module: app }, fail, missing);
// git's own words, through unchanged (the host's refusal arrives as its sentence)
const code = await gitWithToken('clone', url, token, { flags: ['-q', '-o', DEFAULT_REMOTE], after: [dir] }, fail);
if (code !== 0) fail(`git could not clone ${app}`, 1);

// 4 · the remote atelier as `atelier remote` sets it: the host you signed in at, the computer, the app
if (!setRemote(dir, DEFAULT_REMOTE, remoteUrl(host, computer, app))) fail(`git could not set the remote "${DEFAULT_REMOTE}"`, 1);
if (!fs.existsSync(path.join(dir, '.gitignore'))) fs.writeFileSync(path.join(dir, '.gitignore'), GITIGNORE);
const short = git(dir, ['rev-parse', '--short=7', 'HEAD']).out || 'no commit yet';
console.log(`cloned ${app} at ${short} · remote ${DEFAULT_REMOTE} → ${computer}`);
