/* atelier · the attach client, one for both verbs: `atelier attach` (the
 * workspace's shell) and `atelier agent attach` (its agent's live session).
 * They differ only in what they ask to be put in front of (`onto`), in what
 * the footer says on the agent's session, and in what a detach says.
 *
 * The CLI asks the host for the attach with your session
 * (POST /api/attach { target, mode, onto }); the host checks that you may
 * sit in that workspace (you are a member of the chat it serves; or watch
 * it). Then the terminal goes into raw mode on the alternate screen, the
 * screen is drawn as the host streams it (GET /api/attach/<id>/screen, one
 * JSON frame per line: the pane's lines and cursor, who is here, and who
 * started typing each line), with a one-line footer, and every key
 * is sent (POST /api/attach/<id>/keys, batched every 30 ms). --watch sends no
 * keys. Ctrl-] detaches (POST /api/attach/<id>/detach) and puts the terminal
 * back.
 *
 * The modes: both verbs write (your keys go to the shell, or to the agent's
 * session) unless --watch: talking to an agent and attaching to it are one
 * right. On the agent's
 * session your keys go through its harness, which types the chat's messages
 * into the same input: they never mix, and it never clears what you typed. A
 * screen the host closes before its first frame is a refusal, said as that
 * one line, exit 1.
 *
 * The terminal as one knows it from ssh and tmux:
 *   - the size: the CLI says its terminal's size with the attach and again
 *     whenever it changes (POST /api/attach/<id>/view { size }); the pane
 *     follows it (the smallest of the terminals attached, as tmux does). The
 *     rows it gives are the terminal's less the footer's one, as tmux leaves one
 *     for its status line.
 *   - scrollback: the mouse wheel, or Shift-PageUp and Shift-PageDown, scroll
 *     your own view into the pane's scrollback (POST .../view { scroll }); the
 *     footer says how far up you are; a key typed, or scrolling back down,
 *     brings you to the bottom. The host sends the rows from where you are,
 *     with the marks of those rows. The wheel needs the terminal's mouse
 *     reporting: to select text while attached, hold Option (Fn in some
 *     terminals), as with tmux's mouse on. New output never pulls a scrolled
 *     view down (the host keeps it on its rows). A screen whose program draws
 *     on the alternate screen keeps no scrollback (tmux keeps none there): the
 *     host says so once, and the footer shows it.
 *   - a resize never tears the view: each frame is drawn whole in one
 *     synchronized update (terminals that know it show it at once), and after
 *     a resize the screen is cleared and drawn again from the last frame.
 *   - the way out, whichever it is (detach, the host closing it, a failure),
 *     gives the terminal back as it was: raw mode off, mouse reporting off,
 *     the cursor shown, your own screen back.
 *
 * Every keystroke carries its author: on a shell, a line someone else
 * started typing is drawn with their name in front, `[Sam] ~ $ npm test`, as
 * the host marks it (the frame's `marks`); your own lines (from any of your
 * terminals) are drawn as they are.
 *
 * Exit: 0 done · 1 refused or failed · 2 written wrongly · 3 not signed in on
 * that host · 4 signed in, but no grant (the message names the line you would
 * need, built from the name you typed).
 *
 * Dependency-free: node builtins and global fetch with a streaming body.
 */
import { resolveHost, askHost, sentenceOf, hostAnswer, unreachable, notSignedIn, normalHost } from './session.js';
import { DEFAULT_REMOTE, moduleHere, parseRemote, remoteOf } from './repo.js';
import { failer, sessionAt } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';

/* The two verbs: both write unless --watch. */
const VERBS = {
  shell: { name: 'attach', mode: 'write', watch: 'see the screen; your keys are not sent' },
  agent: { name: 'agent attach', mode: 'write', watch: "see the screen; your keys are not sent (without it you type into the agent's session:\nit answers you on its screen, never in the chat)" },
};

export const SHELL_EXITED = 'the shell exited';

const specOf = (onto) => ({
  usage: `atelier ${VERBS[onto].name} [computer][/workspace] [--watch] [--host <url>]`,
  words: [['[computer][/workspace]', "nothing: the remote computer's main · k1: a computer's main · /pair: a workspace on the\n"
    + "remote · k1/pair: always. The remote is this module folder's (atelier remote <computer>);\nwithout one, your one computer"]],
  options: [{ flag: '--watch', help: VERBS[onto].watch }, { flag: '--write', help: 'type into it (the default, said out loud)' }, HOST],
  most: 1,
});

/* What a detach adds: the last one out leaves a handover for the primary agent; else others are still here. */
const afterDetach = (handover) => handover === true ? ' · handover written' : handover === false ? ' · others still here' : '';

/* A line someone else started typing, with their name in front: what the frame's marks say, for this attach and this
 * person (your own lines, from this terminal or another of yours, are drawn as they are). */
export function markedLines(frame, self, me) {
  const lines = [...frame.lines];
  const cursor = { ...frame.cursor };
  for (const m of Array.isArray(frame.marks) ? frame.marks : []) {
    if (!m || m.attach === self || (me && m.person === me) || !Number.isInteger(m.row) || m.row < 0 || m.row >= lines.length) continue;
    const tag = `[${String(m.name)}] `;
    lines[m.row] = tag + lines[m.row];
    if (cursor.y === m.row) cursor.x += [...tag].length;
  }
  return { lines, cursor };
}

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
  const r = await askHost(host, 'GET', '/api/computers', { session });
  if (r.status === 0) fail(unreachable(host), 1);
  if (r.status === 401) fail(notSignedIn(host), 3);
  const list = r.status === 200 && Array.isArray(r.body?.computers) ? r.body.computers.filter((c) => c && c.id && c.label) : null;
  const idOf = (name) => list?.find((c) => c.id === name)?.id ?? list?.find((c) => c.label === name)?.id ?? name;
  if (named) return `${idOf(named)}/${workspace}`;
  const mod = moduleHere();
  const remote = mod && parseRemote(remoteOf(mod.dir, DEFAULT_REMOTE) ?? '');
  if (remote && normalHost(remote.host) === host) return `${idOf(remote.computer)}/${workspace}`;
  if (list === null) fail(sentenceOf(r, `the host at ${host} answered ${r.status}`), 1);
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

  const out = process.stdout, inp = process.stdin;
  const tty = !!out.isTTY;
  /* The size the pane should have: this terminal less the footer's row. None when the output is not a terminal. */
  const sizeNow = () => tty ? { cols: out.columns || 80, rows: Math.max(1, (out.rows || 24) - 1) } : null;

  // 1 · asked: the session, the target, what to be put in front of, and this terminal's size, to the host
  const to = await targetFor(target, host, session, fail);
  const asked = hostAnswer(await askHost(host, 'POST', '/api/attach', { body: { ...(to ? { target: to } : {}), mode, onto, ...(tty ? { size: sizeNow() } : {}) }, session }),
    host, fail, { ok: 201 });
  if (typeof asked.attach !== 'string') fail(`the host at ${host} opened no attach`, 1);
  const { attach: id, computer, workspace } = asked;
  const where = `${computer}/${workspace}`;

  // ---------- the terminal ----------

  // what a session may have turned on (mouse, focus, bracketed paste, a synchronized update left open) is turned off again,
  // and the cursor shown: a terminal left in those modes reports into whatever owns it next
  const RESTORE = '\x1b[?2026l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1006l\x1b[?2004l\x1b[?25h';
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (inp.isTTY) { try { inp.setRawMode(false); } catch {} }
    if (tty) out.write(`${RESTORE}\x1b[?1049l`);
  };
  // every way out gives the terminal back, a failure or the host closing it as much as a detach
  process.on('exit', restore);
  // the alternate screen (your shell's screen comes back as it was); the wheel reported (SGR), for the scrollback
  if (tty) out.write('\x1b[?1049h\x1b[2J\x1b[?1000h\x1b[?1006h');
  if (inp.isTTY) inp.setRawMode(true);
  inp.resume();

  /* A line clipped to the terminal's width by its VISIBLE characters: the pane's colours travel as escape sequences
     (the host captures the pane with them), which take no column and are kept whole; the colour is reset at the end so
     nothing bleeds into the footer or the next line. */
  const ESC = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y;
  const clip = (s, w) => {
    const text = String(s).replace(/\t/g, '    '), max = Math.max(0, w);
    let out = '', seen = 0, i = 0;
    while (i < text.length) {
      ESC.lastIndex = i;
      const m = ESC.exec(text);
      if (m) { out += m[0]; i += m[0].length; continue; }
      const cp = text.codePointAt(i), ch = String.fromCodePoint(cp);
      i += ch.length;
      if (seen < max) { out += ch; seen++; }
    }
    return out + (out.includes('\x1b') ? '\x1b[0m' : '');
  };

  let note = '';
  let last = null;
  /* Who else is here, from the frame's `here` (every attach on that screen): their names, or nobody. */
  const others = () => {
    const names = [...new Set((Array.isArray(last?.here) ? last.here : []).filter((h) => h && h.attach !== id).map((h) => String(h.name)))];
    return names.length ? names.join(', ') : 'nobody';
  };
  const footer = () => {
    const up = last?.scrolled ? ` · scrollback: ${last.scrolled.up} of ${last.scrolled.history} rows up, the wheel or Shift-PageDown${watch ? '' : ' or a key'} to come back` : '';
    // on the agent's session your keys share its input with the chat's messages: the footer says you are talking to it
    const mine = watch ? ' · watch' : onto === 'agent' ? ' · typing to the agent' : '';
    const text = ` attached · ${where} · also here: ${others()}${mine}${up} · Ctrl-] to detach${note ? ` · ${note}` : ''} `;
    return `\x1b[7m${clip(text, (out.columns || 80)).padEnd(Math.min(out.columns || 80, 200))}\x1b[0m`;
  };
  /* The lines that fit (the part with the cursor in it; a scrolled view from its top), the footer, then the cursor where
   * the pane has it (hidden while scrolled back). One synchronized update, so a terminal that knows it shows the frame at
   * once, never half drawn; `whole` clears the screen first (after a resize the terminal may have moved what it showed). */
  function draw(f, whole = false) {
    if (f) last = f;
    const rows = out.rows || 24, cols = out.columns || 80, room = Math.max(1, rows - 1);
    let s = `${tty ? '\x1b[?2026h' : ''}\x1b[?25l${whole ? '\x1b[2J' : ''}\x1b[H`;
    if (last) {
      const { lines, cursor } = markedLines(last, id, entry.person?.id);
      const top = last.scrolled ? 0 : cursor.y >= room ? cursor.y - room + 1 : 0;
      for (let i = 0; i < room; i++) s += `\x1b[${i + 1};1H${clip(lines[top + i] ?? '', cols)}\x1b[K`;
      s += `\x1b[${rows};1H${footer()}`;
      if (!last.scrolled) s += `\x1b[${cursor.y - top + 1};${Math.min(cursor.x, cols - 1) + 1}H\x1b[?25h`;
    } else s += `\x1b[${rows};1H${footer()}\x1b[?25h`;
    out.write(s + (tty ? '\x1b[?2026l' : '\n'));
  }

  // ---------- keys: batched every 30 ms, in order ----------

  const stream = new AbortController();   // the screen's request, aborted by a detach

  // keys and scrolls go out in order, batched every 30 ms
  let pending = '', scrollBy = 0, timer = null, sending = Promise.resolve();
  const flush = () => {
    timer = null;
    const keys = pending, scroll = scrollBy;
    pending = ''; scrollBy = 0;
    if (keys) sending = sending.then(() => askHost(host, 'POST', `/api/attach/${id}/keys`, { body: { keys }, session })).catch(() => {});
    if (scroll) sending = sending.then(() => askHost(host, 'POST', `/api/attach/${id}/view`, { body: { scroll }, session })).catch(() => {});
    return sending;
  };

  // the terminal changed size: drawn again whole at once from the last frame, and the new size said (the pane follows; a
  // window dragged wider says many sizes in a row: the last one, 80 ms after the others stop)
  let resized = null;
  if (tty) out.on('resize', () => {
    draw(null, true);
    clearTimeout(resized);
    resized = setTimeout(() => { sending = sending.then(() => askHost(host, 'POST', `/api/attach/${id}/view`, { body: { size: sizeNow() }, session })).catch(() => {}); }, 80);
  });

  /* What the terminal sent, less the view's own gestures: the wheel (SGR mouse reports; a click is dropped, never sent to
   * the pane) and Shift-PageUp / Shift-PageDown scroll this view, three rows a notch, a screen less one a page. */
  const page = () => Math.max(1, (out.rows || 24) - 2);
  const gestures = (s) => s
    .replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (_, b) => { const n = Number(b); if (n & 64) scrollBy += (n & 3) === 0 ? 3 : (n & 3) === 1 ? -3 : 0; return ''; })
    .replace(/\x1b\[5;2~/g, () => { scrollBy += page(); return ''; })
    .replace(/\x1b\[6;2~/g, () => { scrollBy -= page(); return ''; });

  let leaving = false;
  /* The host answers a detach with whether this was the last one out of the workspace (the handover written). */
  async function detach(code = 0) {
    if (leaving) return;
    leaving = true;
    if (timer) clearTimeout(timer);
    await flush();
    const d = await askHost(host, 'POST', `/api/attach/${id}/detach`, { session });
    stream.abort();
    restore();
    console.log(`\n  detached · the workspace keeps running${afterDetach(d.body.handover)}\n`);
    process.exit(code);
  }

  /* On the agent's session the keys that stop or end the program never go through: Ctrl-Z (suspends the agent's program
   * inside the sandbox until someone types fg), Ctrl-C (twice ends it), Ctrl-D (ends it on an empty line) and Ctrl-\.
   * Esc stops its turn and still goes. The footer says so once. */
  const STOPPING = /[\x03\x04\x1a\x1c]/g;
  let stoppingSaid = false;
  const safe = (s) => {
    if (onto !== 'agent' || !STOPPING.test(s)) return s;
    STOPPING.lastIndex = 0;
    if (!stoppingSaid) { stoppingSaid = true; note = 'Ctrl-C, Ctrl-D, Ctrl-Z do not reach the agent; Esc stops its turn, Ctrl-] leaves'; if (last) draw(last); }
    return s.replace(STOPPING, '');
  };
  inp.on('data', (d) => {
    const s = d.toString('utf8');
    const at = s.indexOf('\x1d');   // Ctrl-]
    const keys = safe(gestures(at >= 0 ? s.slice(0, at) : s));
    if (keys && !watch) pending += keys;
    if ((pending || scrollBy) && !timer) timer = setTimeout(flush, 30);
    if (at >= 0) void detach(0);
  });
  process.on('SIGTERM', () => void detach(0));
  process.on('SIGHUP', () => void detach(0));

  // ---------- 3 · the screen, as the host streams it ----------

  draw();
  let res;
  try {
    res = await fetch(`${host}/api/attach/${id}/screen`, { headers: { authorization: `Session ${session}` }, signal: stream.signal });
  } catch {
    restore(); fail(unreachable(host), 1);
  }
  if (res.status !== 200) { restore(); fail(`the screen could not be opened (${res.status})`, 1); }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const raw = buf.slice(0, nl); buf = buf.slice(nl + 1);
        let f;
        try { f = JSON.parse(raw); } catch { continue; }
        if (Array.isArray(f.lines)) draw(f);
        else if (typeof f.refused === 'string') { note = f.refused; draw(); }
        else if (typeof f.closed === 'string' && !leaving) {
          leaving = true; restore();
          // the shell's own exit (exit, Ctrl-D) is a way out: the workspace keeps running, the next attach starts a new shell
          if (onto === 'shell' && f.closed === SHELL_EXITED) { console.log(`\n  detached · ${SHELL_EXITED} · the workspace keeps running${afterDetach(f.handover)}\n`); process.exit(0); }
          // closed before its first frame: the host refused the attach: its sentence
          if (!last) fail(f.closed, 1);
          console.log(`\n  detached · ${where} closed the attach: ${f.closed}\n`); process.exit(1);
        }
      }
    }
  } catch { /* aborted by a detach */ }
  if (!leaving) { restore(); fail(`the host at ${host} closed the screen`, 1); }
}
