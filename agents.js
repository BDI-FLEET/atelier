#!/usr/bin/env node
/* atelier agents — every agent the fleet holds as yours at a host, one line each: its name, whether it is the primary of
 * your 1:1 (your own agent, once made askable on the Agents page), where it may be asked from, your own 1:1 said as
 * such, and the folder this machine holds for it (agent new --here), seen from inside it or beside it. Which agent a
 * workspace runs (agent primary <name>) is that workspace's: atelier agent, agent.js.
 *
 *   atelier agents [--host <url>]
 *
 *   Alex's Bayard   primary of your 1:1 · asked from nowhere
 *   reviewer        asked from your 1:1, Sam, example-co · folder ./reviewer/
 *
 * The host answers GET /api/agents and GET /api/computers (agent-host.js): each agent's `exposures` the chats,
 * companies and people it may be asked from; the chat your own computer serves is your 1:1. The prompt the host holds
 * is never printed. A machine's verb.
 *
 * Exit 0 done · 1 the host cannot be reached or refused, or inside a sandbox · 2 written wrongly · 3 not signed in on
 * that host.
 */
import { resolveHost } from './session.js';
import { failer, inSandbox } from './ops.js';
import { readArgs, HOST } from './args.js';
import { folderFor } from './agent-folder.js';
import { agentsAt, ownAt, askedFrom } from './agent-host.js';

const fail = failer('agents');
const { opts } = readArgs(process.argv.slice(2), { usage: 'atelier agents [--host <url>]', options: [HOST] }, fail);
if (inSandbox()) fail('inside a sandbox the agents are the fleet\'s: atelier agents is a machine\'s', 1);

const host = resolveHost(opts.host);
const list = await agentsAt(host, fail);
if (!list.length) { console.log('\n  no agents yet\n'); process.exit(0); }
const own = await ownAt(host, fail);
const width = Math.max(...list.map((a) => a.name.length)) + 3;
console.log('');
for (const a of list) {
  const from = askedFrom(own, a);
  const folder = folderFor(process.cwd(), host, a);
  const said = [a.primary === true && 'primary of your 1:1', `asked from ${from.length ? from.join(', ') : 'nowhere'}`, folder && `folder ${folder}`];
  console.log(`  ${a.name.padEnd(width)}${said.filter(Boolean).join(' · ')}`);
}
console.log('');
