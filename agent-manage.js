#!/usr/bin/env node
/* atelier agent share · unshare · rules · rm — one of your agents managed at the host, by the routes the Agents page
 * uses (agent-host.js). share: the agent there may ask it, on a message of yours, its connector holding nothing; unshare:
 * it may not any more; rules: its prompt replaced by a file, as written; rm: it is deleted, asked from nowhere.
 *
 *   atelier agent share <name> [<chat>]
 *   atelier agent unshare <name> [<chat>]
 *   atelier agent rules <name> --prompt file
 *   atelier agent rm <name>
 *
 *   agent reviewer · shared with your 1:1: your agent there may ask it
 *   agent reviewer · shared with Tesis: the agent there may ask it, on a message of yours
 *
 * The agent is named as atelier agents lists it, or by its id. No chat, or `your 1:1`: your own 1:1, the one the agent's
 * own computer serves. A chat to share with: by its name among those the host offers (chats you are in with an agent of
 * their own), or its id; to unshare: among those the agent is asked from, as atelier agents names them. Shared there already, or not shared there: nothing is
 * asked. A folder of the agent on this machine (agent new --here) is left as it is. A machine's verbs.
 *
 * Exit 0 done, or nothing to change · 1 the host cannot be reached, or inside a sandbox · 2 written wrongly, no such
 * agent or chat, a prompt the host refuses · 3 not signed in on that host · 4 the host refused it (its sentence).
 */
import fs from 'node:fs';
import { resolveHost } from './session.js';
import { failer, inSandbox } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';
import { folderFor } from './agent-folder.js';
import { listedAt, computersAt, ownChatOf, placesOf, oneNamed, agentAnswer, sharedLine, YOUR_ONE_TO_ONE } from './agent-host.js';

const USAGES = {
  share: 'atelier agent share <name> [<chat>]',
  unshare: 'atelier agent unshare <name> [<chat>]',
  rules: 'atelier agent rules <name> --prompt file',
  rm: 'atelier agent rm <name>',
};
const sub = process.argv[2];
const fail = failer(`agent ${sub}`);
const sharing = sub === 'share';
const SPEC = {
  usage: USAGES[sub], sub, most: sub === 'share' || sub === 'unshare' ? 2 : 1,
  options: [...(sub === 'rules' ? [{ flag: '--prompt', value: 'file', help: 'the agent\'s system prompt in place of the one the host holds' }] : []), HOST],
};
const { opts, words } = readArgs(process.argv.slice(3), SPEC, fail);
if (inSandbox()) fail(`inside a sandbox the agents are the fleet's: atelier agent ${sub} is a machine's`, 1);
const [name, chat] = words;
if (!name) fail(`agent ${sub} <name>: one of your agents, as atelier agents lists it\n\n${helpOf(SPEC)}`);
let prompt = null;
if (sub === 'rules') {
  if (!opts.prompt) fail(`agent rules replaces the prompt the host holds: --prompt <file>\n\n${helpOf(SPEC)}`);
  try { prompt = fs.readFileSync(opts.prompt, 'utf8'); } catch { fail(`cannot read ${opts.prompt}`); }
}

const host = resolveHost(opts.host);
const { agents, chats } = await listedAt(host, fail);
const agent = oneNamed(agents, name, { what: 'agent', fail, none: () => fail(`no agent of yours is named "${name}" · atelier agents`) });
const folder = folderFor(process.cwd(), host, agent);
const theFolder = folder === 'here' ? 'this folder' : `the folder ${folder}`;
const say = (...parts) => console.log(parts.filter(Boolean).join(' · '));

if (sub === 'rules') {
  const r = await agentAnswer(host, fail, agent, 'rules', { rules: prompt });
  say(`agent ${agent.name}`, 'its prompt replaced', `version ${r.version}`, folder && `${theFolder} keeps the prompt it had`);
} else if (sub === 'rm') {
  await agentAnswer(host, fail, agent, 'delete');
  say(`agent ${agent.name}`, 'deleted: nobody may ask it, its prompt is gone', folder && `${theFolder} stays on this machine`);
} else {
  const computers = await computersAt(host, fail), places = placesOf(computers, agent);
  const { to, where } = chat === undefined || chat === YOUR_ONE_TO_ONE ? ownOne(computers) : named(sharing ? chats : places);
  if ((Array.isArray(agent.exposures) ? agent.exposures : []).some((x) => x?.to === to) === sharing) say(`agent ${agent.name}`, `${sharing ? 'already' : 'not'} shared with ${where}: nothing changed`);
  else {
    await agentAnswer(host, fail, agent, sub, { to });
    say(sharedLine(agent.name, where, sharing));
  }
}

/* No chat named: the person's own 1:1, the one the agent's own computer serves. */
function ownOne(computers) {
  const to = ownChatOf(computers, agent);
  if (!to) fail(`${agent.name} lives on ${agent.computerName ?? agent.computer}, not your own computer: name the chat · atelier agent ${sub} ${agent.name} <chat>`);
  return { to, where: YOUR_ONE_TO_ONE };
}

/* The chat named, among `among`: those the host offers to share with, or those the agent is asked from. */
function named(among) {
  const none = () => fail(sharing
    ? `no chat you may share ${agent.name} with is named "${chat}": a chat you are in with an agent of its own, or ${YOUR_ONE_TO_ONE} when none is named`
    : `${agent.name} is asked from no chat named "${chat}": atelier agents says where it is asked from`);
  const c = oneNamed(among, chat, { what: 'chat', fail, none });
  return { to: c.id, where: c.name };
}
