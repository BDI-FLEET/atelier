#!/usr/bin/env node
/* atelier agent · agent new · agent primary — agent lists the agents in a
 * workspace; new makes one beside the others, a model session with its own
 * system prompt. Every workspace has one primary agent, which receives the
 * chat and the calls and gets the handover; it is the first agent unless
 * agent primary <name> says otherwise. (agent attach: agent-attach.js.)
 *
 *   atelier agent [computer][/workspace]
 *   atelier agent new <name> [--prompt file] [computer][/workspace]
 *   atelier agent primary <name> [computer][/workspace]
 *
 *   agent       primary · receives the chat · fake-agent · awake
 *   reviewer    made 7 Oct 14:05 by Alex · its prompt kept · not started
 *
 * The verb works inside a workspace you may sit in: the host checks you
 * are a member of the chat it serves (the attach right). The workspace as
 * attach names it: k1/main, /main (your own computer), k1 (its main), or
 * nothing (your own computer's main). Inside a sandbox: its own workspace.
 * The prompt is held by the computer, never a file in the workspace. new and
 * primary are recorded. One session runs per workspace: an agent made beside
 * the primary keeps its prompt, and its session does not start.
 */
import fs from 'node:fs';
import { failer, runOp, exitOf, inSandbox } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';
import { AGENT_NAME_CHARS } from './limits.js';

const AGENT_NAME = new RegExp(`^[a-z][a-z0-9-]{0,${AGENT_NAME_CHARS - 1}}$`);
const SPEC = {
  usage: 'atelier agent [computer][/workspace]\n       atelier agent new <name> [--prompt file] [computer][/workspace]\n'
    + '       atelier agent primary <name> [computer][/workspace]\n       atelier agent attach [computer][/workspace] [--watch]',
  options: [{ flag: '--prompt', value: 'file', subs: ['new'], help: 'the new agent\'s system prompt' }, HOST],
};
const USAGE = helpOf(SPEC);
const fail = failer('agent');
const argv = process.argv.slice(2);
const sub = argv[0] === 'new' || argv[0] === 'primary' ? argv.shift() : 'list';
const { opts, words } = readArgs(argv, { ...SPEC, sub, most: sub === 'list' ? 1 : 2 }, fail);
const name = sub === 'list' ? null : words.shift();
if (sub !== 'list' && (!name || !AGENT_NAME.test(name))) fail(`agent ${sub} <name>: lower-case letters, digits and dashes\n\n${USAGE}`);
const [target = null] = words;
let prompt = null;
if (opts.prompt) { try { prompt = fs.readFileSync(opts.prompt, 'utf8'); } catch { fail(`cannot read ${opts.prompt}`); } }
if (target !== null && !/^[A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]*)?$/.test(target)) fail(`"${target}" isn't a workspace: [computer][/workspace]\n\n${USAGE}`);
const [computer, workspace] = target ? target.split('/') : [];
const where = { host: resolveHost(opts.host), ...(computer ? { computer } : {}), ...(workspace ? { workspace } : {}) };
if (inSandbox() && (computer || workspace)) fail('inside a workspace, agent acts on this one: no target', 2);
const op = sub === 'list' ? { verb: 'agents' } : sub === 'new' ? { verb: 'agent-new', name } : { verb: 'agent-primary', name };
const code = await runOp('agent', where, op, {
  during: sub === 'new' ? (into) => into({ prompt: prompt ?? '' }) : undefined,
  socket: sub === 'new' ? { prompt: prompt ?? '' } : undefined,
});
process.exit(exitOf(code));
