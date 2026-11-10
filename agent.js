#!/usr/bin/env node
/* atelier agent · agent new · agent primary — agent lists the agents in a
 * workspace; new makes one beside the others, a model session with its own
 * system prompt. Every workspace has one primary agent, which receives the
 * chat and the calls and gets the handover; it is the first agent unless
 * agent primary <name> says otherwise. (agent attach: agent-attach.js.)
 *
 *   atelier agent [computer][/workspace]
 *   atelier agent new <name> [--prompt file] [--here --description line [--model m]] [computer][/workspace]
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
 *
 * new --here also gives the agent a folder on this machine, ./<name>/ (agent-folder.js), which holds it as Claude Code
 * defines an agent: .claude/agents/<name>.md, its name and --description in front matter and its prompt the body, which
 * is the agent's own system prompt in place of Claude Code's; .claude/settings.json, so claude started there is that
 * agent; and the file naming the agent by the id the host lists it with. Claude Code skips a definition without a
 * description, so --here needs one; it and --model are written in the folder alone, never sent to the host. A ./<name>
 * that is a file or a folder that is not empty is refused before the host is asked; a folder is laid out only once the
 * agent is made. A machine's verb. (Every agent you have, and the folders this machine holds: atelier agents, agents.js.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { failer, runOp, exitOf, inSandbox } from './ops.js';
import { resolveHost } from './session.js';
import { readArgs, helpOf, HOST } from './args.js';
import { AGENT_NAME_CHARS, AGENT_DESCRIPTION_CHARS, AGENT_MODEL_CHARS } from './limits.js';
import { NAMING_FILE, SETTINGS_FILE, definitionOf, oneLine, agentsAt, notFree, layOut } from './agent-folder.js';

const AGENT_NAME = new RegExp(`^[a-z][a-z0-9-]{0,${AGENT_NAME_CHARS - 1}}$`);
const SPEC = {
  usage: 'atelier agent [computer][/workspace]\n       atelier agent new <name> [--prompt file] [--here --description line [--model m]] [computer][/workspace]\n'
    + '       atelier agent primary <name> [computer][/workspace]\n       atelier agent attach [computer][/workspace] [--watch]',
  options: [{ flag: '--prompt', value: 'file', subs: ['new'], help: 'the new agent\'s system prompt' },
    { flag: '--here', subs: ['new'], help: `and its folder on this machine, ./<name>/, holding it as Claude Code's agent:\n`
      + `${definitionOf('<name>')} defines it, its prompt the agent's own system prompt;\n`
      + `${SETTINGS_FILE} makes claude started there that agent; ${NAMING_FILE} names it` },
    { flag: '--description', value: 'line', subs: ['new'], check: oneLine('--description', AGENT_DESCRIPTION_CHARS),
      help: 'with --here: when to use the agent, one line in its definition (not sent to the host)' },
    { flag: '--model', value: 'm', subs: ['new'], check: oneLine('--model', AGENT_MODEL_CHARS),
      help: 'with --here: the model its definition names, as written (an alias or a full model id)' }, HOST],
};
const USAGE = helpOf(SPEC);
const fail = failer('agent');
const argv = process.argv.slice(2);
const sub = argv[0] === 'new' || argv[0] === 'primary' ? argv.shift() : 'list';
const { opts, words } = readArgs(argv, { ...SPEC, sub, most: sub === 'list' ? 1 : 2 }, fail);
const name = sub === 'list' ? null : words.shift();
if (sub !== 'list' && (!name || !AGENT_NAME.test(name))) fail(`agent ${sub} <name>: lower-case letters, digits and dashes\n\n${USAGE}`);
const [target = null] = words;
const folder = opts.here ? path.resolve(name) : null, shown = `./${name}/`;
if (folder && inSandbox()) fail('inside a sandbox there is no folder of a machine: agent new --here is a machine\'s', 1);
for (const only of ['description', 'model']) if (!folder && only in opts) fail(`--${only} is written in the agent's folder alone: with --here\n\n${USAGE}`);
if (folder && !opts.prompt) fail(`--here writes its prompt as the body of ${definitionOf(name)}: --prompt <file>\n\n${USAGE}`);
if (folder && !('description' in opts)) fail(`--here defines the agent for Claude Code, which skips a definition without one: --description "<one line>"\n\n${USAGE}`);
let prompt = null;
if (opts.prompt) { try { prompt = fs.readFileSync(opts.prompt, 'utf8'); } catch { fail(`cannot read ${opts.prompt}`); } }
if (target !== null && !/^[A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]*)?$/.test(target)) fail(`"${target}" isn't a workspace: [computer][/workspace]\n\n${USAGE}`);
const [computer, workspace] = target ? target.split('/') : [];
const where = { host: resolveHost(opts.host), ...(computer ? { computer } : {}), ...(workspace ? { workspace } : {}) };
if (inSandbox() && (computer || workspace)) fail('inside a workspace, agent acts on this one: no target', 2);
const taken = folder && notFree(folder, shown);
if (taken) fail(`${taken}: agent new --here lays out a folder of its own`);
const op = sub === 'list' ? { verb: 'agents' } : sub === 'new' ? { verb: 'agent-new', name } : { verb: 'agent-primary', name };
const code = await runOp('agent', where, op, {
  during: sub === 'new' ? (into) => into({ prompt: prompt ?? '' }) : undefined,
  socket: sub === 'new' ? { prompt: prompt ?? '' } : undefined,
});
if (folder && code === 0) await layOutMade();
process.exit(exitOf(code));

/* The folder of the agent just made, named by the id the host lists it with. */
async function layOutMade() {
  const notLaid = (why) => fail(`agent ${name} was made, but ${why}: no folder laid out · atelier agents`, 1);
  const made = (await agentsAt(where.host, notLaid)).find((a) => a.name === name);
  if (!made) notLaid('the host does not list it');
  const fields = { name, description: opts.description, model: opts.model };
  try { layOut(folder, fields, prompt, { id: made.id, name, host: where.host, made: new Date().toISOString() }); }
  catch (e) { notLaid(`${shown} could not be laid out (${e.code ?? e.message})`); }
  console.log(`folder ${shown} · ${definitionOf(name)} defines it · start it: cd ${name} && claude · or there: claude --agent ${name}`);
}
