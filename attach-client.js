/* atelier · the attach client, one for both verbs: `atelier attach` (the
 * workspace's shell) and `atelier agent attach` (its agent's live session).
 * They differ only in what they ask to be put in front of (`onto`), in what
 * the footer says on the agent's session, and in what a detach says.
 *
 * The CLI asks the host for the attach with your session
 * (POST /api/attach { target, mode, onto, size }); the host checks that you may
 * sit in that workspace (you are a member of the chat it serves; or watch
 * it). Then the terminal (attach-terminal.js, the one every attach's caller
 * shares) draws the screen as the host streams it (GET /api/attach/<id>/screen,
 * one JSON frame per line: the pane's lines and cursor, who is here, and who
 * started typing each line), and sends every key (POST /api/attach/<id>/keys),
 * the size and the scrolls (POST /api/attach/<id>/view); Ctrl-] detaches
 * (POST /api/attach/<id>/detach). Those four routes, on your session, are the
 * terminal's doors here.
 *
 * The modes: both verbs write (your keys go to the shell, or to the agent's
 * session) unless --watch: talking to an agent and attaching to it are one
 * right. On the agent's
 * session your keys go through its harness, which types the chat's messages
 * into the same input: they never mix, and it never clears what you typed. A
 * screen the host closes before its first frame is a refusal, said as that
 * one line, exit 1.
 *
 * Exit: 0 done · 1 refused or failed · 2 written wrongly · 3 not signed in on
 * that host · 4 signed in, but no grant (the message names the line you would
 * need, built from the name you typed).
 *
 * Dependency-free: node builtins and global fetch with a streaming body.
 */
import { resolveHost, askHost, sentenceOf, hostAnswer, hostAnswered, unreachable, notSignedIn, normalHost, COMPUTERS_PATH } from './session.js';
import { DEFAULT_REMOTE, moduleHere, parseRemote, remoteOf } from './repo.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';
import { attachTerminal, terminalSize, markedLines, SHELL_EXITED } from './attach-terminal.js';

export { markedLines, SHELL_EXITED };

/* The two verbs: both write unless --watch. */
const VERBS = {
  shell: { name: 'attach', mode: 'write', watch: 'see the screen; your keys are not sent' },
  agent: { name: 'agent attach', mode: 'write', watch: "see the screen; your keys are not sent (without it you type into the agent's session:\nit answers you on its screen, never in the chat)" },
};

const specOf = (onto) => ({
  usage: `atelier ${VERBS[onto].name} [computer][/workspace] [--watch] [--host <url>]`,
  words: [['[computer][/workspace]', "nothing: the remote computer's main · k1: a computer's main · /pair: a workspace on the\n"
    + "remote · k1/pair: always. The remote is this module folder's (atelier remote <computer>);\nwithout one, your one computer"]],
  options: [{ flag: '--watch', help: VERBS[onto].watch }, { flag: '--write', help: 'type into it (the default, said out loud)' }, HOST],
  most: 1,
});

/*
 * Where to attach: both parts default. `atelier attach` alone is the remote computer's main; a bare name is a computer,
 * `atelier attach k1` is k1/main; a leading slash names a workspace on the remote, `atelier attach /pair`; the full path
 * always works.
 *
 * The remote is the one `atelier remote` (or `atelier create`) set: this module folder's git remote `atelier`, when it
 * points at the host this call talks to. Outside a module folder there is none: one computer is that one; with
 * several the CLI does not pick (the host would take one you did not mean), it names them and says how to choose.
 *
 * The CLI speaks of a computer by the word `atelier computers` prints and a remote's URL holds (its label); the host's
 * attach knows a computer by its own name (the id in GET /api/computers). A name typed that is a label is sent as that
 * computer's id; any other name goes as typed, so the host gives its one answer for not-yours and not-there.
 * Returns the target to send ('' for none), or exits through `fail`.
 */
export async function targetFor(typed, host, session, fail) {
  const slash = typed === null ? -1 : typed.indexOf('/');
  const named = typed === null ? '' : slash < 0 ? typed : typed.slice(0, slash);
  const workspace = typed !== null && slash >= 0 ? typed.slice(slash + 1) || 'main' : 'main';
  const r = await askHost(host, 'GET', COMPUTERS_PATH, { session });
  if (r.status === 0) fail(unreachable(host), 1);
  if (r.status === 401) fail(notSignedIn(host), 3);
  const list = r.status === 200 && Array.isArray(r.body?.computers) ? r.body.computers.filter((c) => c && c.id && c.label) : null;
  const idOf = (name) => list?.find((c) => c.id === name)?.id ?? list?.find((c) => c.label === name)?.id ?? name;
  if (named) return `${idOf(named)}/${workspace}`;
  const mod = moduleHere();
  const remote = mod && parseRemote(remoteOf(mod.dir, DEFAULT_REMOTE) ?? '');
  if (remote && normalHost(remote.host) === host) return `${idOf(remote.computer)}/${workspace}`;
  if (list === null) fail(sentenceOf(r, hostAnswered(host, r.status)), 1);
  if (list.length === 1) return `${list[0].id}/${workspace}`;
  // several and no remote: written wrongly (exit 2), the names to pick from and the two ways to pick
  if (list.length > 1) fail(`which computer? you are in ${list.length}: ${list.map((c) => c.label).join(', ')} · name one, `
    + `${list[0].label}${workspace === 'main' ? '' : `/${workspace}`}, or point a module folder at one: atelier remote <computer>`);
  // none listed: the host answers for the workspace alone (a watch line is not in the list)
  return workspace === 'main' ? '' : `/${workspace}`;
}

/* The whole verb: parse argv, ask, draw, send, detach. Never returns. */
export async function runAttach(onto) {
  const verb = VERBS[onto], SPEC = specOf(onto), USAGE = helpOf(SPEC);
  const fail = failer(verb.name);

  const { opts, words: [target = null] } = readArgs(process.argv.slice(2), SPEC, fail);
  if (opts.watch && opts.write) fail(`--watch or --write, not both\n\n${USAGE}`);
  if (target !== null && !/^[A-Za-z0-9_.-]*(\/[A-Za-z0-9_.-]*)?$/.test(target)) fail(`"${target}" isn't a target: [computer][/workspace]\n\n${USAGE}`);
  const mode = opts.watch ? 'watch' : opts.write ? 'write' : verb.mode, watch = mode === 'watch';

  const host = resolveHost(opts.host);
  const entry = sessionAt(host, fail), { session } = entry;

  // 1 · asked: the session, the target, what to be put in front of, and this terminal's size, to the host
  const to = await targetFor(target, host, session, fail);
  const size = terminalSize();
  const asked = hostAnswer(await askHost(host, 'POST', '/api/attach', { body: { ...(to ? { target: to } : {}), mode, onto, ...(size ? { size } : {}) }, session }),
    host, fail, { ok: 201 });
  if (typeof asked.attach !== 'string') fail(`the host at ${host} opened no attach`, 1);
  const { attach: id, computer, workspace } = asked;
  const attachPath = (what) => `/api/attach/${id}/${what}`;

  // 2 · the terminal's doors: the attach's four routes on your session; the screen's request aborted by a detach
  const stream = new AbortController();
  async function* screen() {
    let res;
    try {
      res = await fetch(`${host}${attachPath('screen')}`, { headers: { authorization: `Session ${session}` }, signal: stream.signal });
    } catch {
      throw new Error(unreachable(host));
    }
    if (res.status !== 200) throw new Error(`the screen could not be opened (${res.status})`);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const raw = buf.slice(0, nl); buf = buf.slice(nl + 1);
          let f;
          try { f = JSON.parse(raw); } catch { continue; }
          yield f;
        }
      }
    } catch { /* aborted by a detach */ }
  }
  const doors = {
    keys: (keys) => askHost(host, 'POST', attachPath('keys'), { body: { keys }, session }),
    view: (body) => askHost(host, 'POST', attachPath('view'), { body, session }),
    detach: async () => {
      const d = await askHost(host, 'POST', attachPath('detach'), { session });
      stream.abort();
      return { handover: d.body?.handover };
    },
    screen,
  };

  // 3 · the terminal, until the way out
  await attachTerminal({
    doors, where: `${computer}/${workspace}`, onto, watch, self: id, me: entry.person?.id, kept: 'the workspace keeps running', fail,
    ended: `the host at ${host} closed the screen`,
  });
}
