/* atelier · the folder an agent has on this machine: `atelier agent new <name> --here` lays it out as ./<name>/,
 * `atelier agents` finds it from inside it or beside it. It holds three files:
 *
 *   .claude/agents/<name>.md   the agent as Claude Code defines one: front matter (name, description, model when
 *                              given), then the prompt as written, which is the agent's own system prompt in place of
 *                              Claude Code's, not instructions added beside it as a CLAUDE.md would be
 *   .claude/settings.json      { "agent": "<name>" }: claude started in the folder is that agent (claude --agent <name>
 *                              there as well)
 *   .atelier-agent.json        which agent the folder is, { id, name, host, made }, readable by you alone; never the
 *                              session, which stays in the credentials file (session.js)
 *
 * The agents are the host's: the person's list (GET /api/agents) names each one's id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { askHost, hostAnswer, AGENTS_PATH } from './session.js';
import { sessionAt } from './ops.js';

export const NAMING_FILE = '.atelier-agent.json';
const CLAUDE_DIR = '.claude';
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

/* Where Claude Code finds the agent `name` in a project's folder: Claude Code knows it by the name in its front matter. */
export const definitionOf = (name) => path.join(CLAUDE_DIR, 'agents', `${name}.md`);

/* The check of an option written into the front matter: one line of printable characters, at most `most`; a control
 * character, a line or paragraph separator, a lone surrogate, a byte order mark or U+FFFE/U+FFFF would end the line or
 * fall outside the characters YAML may hold. */
export const oneLine = (flag, most) => (v) => (v.trim() && v.length <= most && !/[\p{Cc}\p{Zl}\p{Zp}\p{Cs}\uFEFF\uFFFE\uFFFF]/u.test(v))
  || `${flag}: one line of printable characters, at most ${most}`;

/* The definition's text: front matter between two lines `---`, each value a double-quoted YAML scalar (a JSON string is
 * one), so that no name or line is read as a null, a boolean, a comment or a key; then the prompt, byte for byte. */
export function definition(fields, prompt) {
  const front = Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return ['---', ...front, '---', ''].join('\n') + prompt;
}

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

/* The folder laid out: the definition of `fields` with `prompt` its body, the settings starting it, and last the naming
 * file readable by you alone, so a folder left half laid out is never taken for the agent's; none replaces a file. */
export function layOut(dir, fields, prompt, naming) {
  const write = (file, text, mode) => {
    const at = path.join(dir, file);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, text, { flag: 'wx', ...(mode ? { mode } : {}) });
    if (mode) fs.chmodSync(at, mode);
  };
  write(definitionOf(fields.name), definition(fields, prompt));
  write(SETTINGS_FILE, JSON.stringify({ agent: fields.name }, null, 2) + '\n');
  write(NAMING_FILE, JSON.stringify(naming, null, 2) + '\n', 0o600);
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
