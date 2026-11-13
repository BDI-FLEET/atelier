/* atelier · the agents as the host holds them, for atelier agents (agents.js), agent new (agent.js) and the verbs that
 * manage one (agent-manage.js): the person's list and what an agent may be shared with, their own 1:1, and an agent's
 * routes on the host. The host (core's services/portal/people.ts) answers, on the session:
 *
 *   GET  /api/agents                    { agents: [{ id, name, computer, computerName, exposures: [{ to, name, mode }],
 *                                         primary?, … }], choices: { chats: [{ id, name }], … } }: `exposures` where each
 *                                         may be asked from; `choices.chats` the chats one may be shared with, those the
 *                                         person is in with an agent of their own, never their own 1:1
 *   GET  /api/computers                 { computers: [{ id, label, kind, computer, chat, … }] }: `id` the token a
 *                                         remote names a computer by, `computer` its id, as an agent's `computer` names
 *                                         it; kind `own` the person's own computer, `chat` the 1:1 it serves
 *   POST /api/agents/<id>/share         { to } → 201: asked from `to` on the owner's word, its connector holding nothing
 *   POST /api/agents/<id>/unshare       { to } → 200
 *   POST /api/agents/<id>/rules         { rules } → 200 { version }: its prompt replaced
 *   POST /api/agents/<id>/delete        → 200
 *
 * Who may share what with whom is the kernel's: the CLI names the chat, the host's sentence says a refusal.
 */
import { askHost, hostAnswer, AGENTS_PATH, COMPUTERS_PATH } from './session.js';
import { sessionAt } from './ops.js';

/* How the person's own 1:1 is said: the one chat their own computer serves. */
export const YOUR_ONE_TO_ONE = 'your 1:1';

/* The person's agents at `host` and what one may be shared with, as the host answers them. */
export async function listedAt(host, fail) {
  const listed = hostAnswer(await askHost(host, 'GET', AGENTS_PATH, { session: sessionAt(host, fail).session }), host, fail);
  const agents = (Array.isArray(listed.agents) ? listed.agents : []).filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string');
  const chats = (Array.isArray(listed.choices?.chats) ? listed.choices.chats : []).filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string');
  return { agents, chats };
}

/* The agents the person has at `host`: { id, name, computer, exposures, primary?, … } each. */
export const agentsAt = async (host, fail) => (await listedAt(host, fail)).agents;

/* The person's computers at `host` as the host lists them, each { computer, label, kind, chat, … }. */
export async function computersAt(host, fail) {
  const listed = hostAnswer(await askHost(host, 'GET', COMPUTERS_PATH, { session: sessionAt(host, fail).session }), host, fail);
  return (Array.isArray(listed.computers) ? listed.computers : []).filter((c) => c && typeof c.computer === 'string');
}

/* The 1:1 a computer serves when it is the person's own; null for every other computer. */
const ownChatIn = (computer) => (computer?.kind === 'own' && typeof computer.chat === 'string' ? computer.chat : null);

/* The computer of the person's an agent lives on; undefined when it is none of them. */
const homeOf = (computers, agent) => computers.find((c) => c.computer === agent.computer);

/* The person's own 1:1 an agent may be asked from by default: the one its own computer serves, when the agent lives
 * there; null when it lives on a computer that is not theirs. */
export const ownChatOf = (computers, agent) => ownChatIn(homeOf(computers, agent));

/* The computer an agent lives on as the person names it: its label, as atelier computers lists it; the name the host
 * gives the agent's computer when it is none of theirs. */
export const homeNameOf = (computers, agent) => homeOf(computers, agent)?.label ?? agent.computerName ?? agent.computer;

/* Where an agent may be asked from, each { id, name }: the person's own 1:1 named as such, every other place by the name
 * the host gives it. */
export const placesOf = (computers, agent) => (Array.isArray(agent.exposures) ? agent.exposures : [])
  .map((x) => ({ id: x?.to, name: computers.some((c) => ownChatIn(c) === x?.to) ? YOUR_ONE_TO_ONE : x?.name }))
  .filter((p) => typeof p.id === 'string' && typeof p.name === 'string' && p.name);

/* The same in words, as atelier agents says them. */
export const askedFrom = (computers, agent) => placesOf(computers, agent).map((p) => p.name);

/* The one of `list` that `word` names, by its id or its name, `what` saying what it is ("agent", "chat"); `none()` fails
 * when nothing is named so, and two of one name are refused, named by their ids. */
export function oneNamed(list, word, { what, none, fail }) {
  const byId = list.find((x) => x.id === word);
  if (byId) return byId;
  const named = list.filter((x) => x.name === word);
  if (named.length > 1) fail(`${named.length} ${what}s are named "${word}": name one by its id: ${named.map((x) => x.id).join(', ')}`);
  return named[0] ?? none();
}

/* The status each of an agent's routes answers once it did what it was asked. */
export const ANSWERED = Object.freeze({ share: 201, unshare: 200, rules: 200, delete: 200 });

/* One of an agent's routes asked on the person's session: its answer, or `fail` with the host's sentence. */
export async function agentAnswer(host, fail, agent, verb, body = {}) {
  const r = await askHost(host, 'POST', `${AGENTS_PATH}/${encodeURIComponent(agent.id)}/${verb}`, { session: sessionAt(host, fail).session, body });
  return hostAnswer(r, host, fail, { ok: ANSWERED[verb] });
}

/* A `fail` that throws its sentence, for a step whose failure is said and the verb goes on. */
export const thrown = (why) => { throw new Error(why); };

/* What a share or an unshare leaves, in one line: who there may ask the agent now. */
export function sharedLine(name, where, sharing) {
  const own = where === YOUR_ONE_TO_ONE;
  const who = own ? 'your agent there' : 'the agent there';
  return sharing ? `agent ${name} · shared with ${where}: ${who} may ask it${own ? '' : ', on a message of yours'}`
    : `agent ${name} · no longer shared with ${where}: ${who} may not ask it`;
}
