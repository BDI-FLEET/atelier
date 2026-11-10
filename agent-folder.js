/* atelier · the folder an agent has on this machine: `atelier agent new <name> --here` lays it out as ./<name>/,
 * `atelier agents` finds it from inside it or beside it. It holds two files:
 *
 *   CLAUDE.md             the agent's prompt as written: what Claude Code reads as its instructions when it starts here
 *   .atelier-agent.json   which agent the folder is, { id, name, host, made }, readable by you alone; never the session,
 *                         which stays in the credentials file (session.js)
 *
 * The agents are the host's: the person's list (GET /api/agents) names each one's id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { askHost, hostAnswer, AGENTS_PATH } from './session.js';
import { sessionAt } from './ops.js';

export const PROMPT_FILE = 'CLAUDE.md';
export const NAMING_FILE = '.atelier-agent.json';

/* The agents the person has at `host`, as its list answers them: { id, name, primary?, exposures, … } each. */
export async function agentsAt(host, fail) {
  const listed = hostAnswer(await askHost(host, 'GET', AGENTS_PATH, { session: sessionAt(host, fail).session }), host, fail);
  return (Array.isArray(listed.agents) ? listed.agents : []).filter((a) => a && typeof a.id === 'string' && typeof a.name === 'string');
}

/* Why `dir` cannot be laid out, `shown` naming it: a file, or a folder that is not empty; null when it is absent or empty. */
export function notFree(dir, shown) {
  const st = fs.statSync(dir, { throwIfNoEntry: false });
  if (!st) return null;
  if (!st.isDirectory()) return `${shown} is not a folder`;
  return fs.readdirSync(dir).length ? `${shown} is not empty` : null;
}

/* The folder laid out: the prompt, and the naming file readable by you alone; neither replaces a file already there. */
export function layOut(dir, prompt, naming) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PROMPT_FILE), prompt, { flag: 'wx' });
  const file = path.join(dir, NAMING_FILE);
  fs.writeFileSync(file, JSON.stringify(naming, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/* The agent the folder `dir` names, or null. */
function namedIn(dir) {
  try {
    const n = JSON.parse(fs.readFileSync(path.join(dir, NAMING_FILE), 'utf8'));
    return n && typeof n.id === 'string' ? n : null;
  } catch { return null; }
}

/* Where this machine holds the folder of `agent` at `host`, seen from `cwd`: `here` inside it, `./<name>/` beside it,
 * else null. A folder counts by the agent's id and host, never by its name alone. */
export function folderFor(cwd, host, agent) {
  const holds = (dir) => { const n = namedIn(dir); return n?.id === agent.id && n.host === host; };
  if (holds(cwd)) return 'here';
  const plain = agent.name === path.basename(agent.name) && agent.name !== '.' && agent.name !== '..';
  return plain && holds(path.join(cwd, agent.name)) ? `./${agent.name}/` : null;
}
