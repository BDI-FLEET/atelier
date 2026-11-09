/* atelier · the attach's terminal: this terminal put in front of a screen someone else keeps, as one knows it from ssh
 * and tmux. It is one for every caller: the portal's `atelier attach` and `atelier agent attach` (attach-client.js),
 * and any other program that reaches an attach its own way. What differs between them comes in as `doors`, functions
 * that send what this terminal says and hand the screen as it is streamed; no address and no session is known here.
 *
 *   - raw mode on the alternate screen; the screen drawn as it streams, one frame at a time, with a one-line footer:
 *     where it is, who else is here, `watch` or `typing to the agent`, and how to leave.
 *   - every key is sent, batched every ATTACH_KEYS_MS; --watch sends none.
 *   - the size: the caller says this terminal's size with the attach (terminalSize), and this terminal says it again
 *     whenever it changes (the view { size }), ATTACH_RESIZE_MS after a window stops being dragged; the rows it gives are
 *     the terminal's less the footer's one, as tmux leaves one for its status line.
 *   - scrollback: the mouse wheel, or Shift-PageUp and Shift-PageDown, scroll your own view into the pane's scrollback
 *     (the view { scroll }); the footer says how far up you are; a key typed, or scrolling back down, brings you to the
 *     bottom. The wheel needs the terminal's mouse reporting: to select text while attached, hold Option (Fn in some
 *     terminals), as with tmux's mouse on. A screen whose program draws on the alternate screen keeps no scrollback: the
 *     screen says so once (a frame { refused }), and the footer shows it.
 *   - a resize never tears the view: each frame is drawn whole in one synchronized update, and after a resize the
 *     screen is cleared and drawn again from the last frame.
 *   - on an agent's session the keys that stop or end its program never go through (Ctrl-C, Ctrl-D, Ctrl-Z, Ctrl-\).
 *   - every keystroke carries its author: a line someone else started typing is drawn with their name in front,
 *     `[Sam] ~ $ npm test`, as the frame's `marks` say; your own lines (from any of your terminals) are drawn as they are.
 *   - Ctrl-] detaches; the way out, whichever it is (detach, the screen closed, a failure, SIGTERM or SIGHUP), gives the
 *     terminal back as it was: raw mode off, mouse reporting off, the cursor shown, your own screen back.
 *
 * Exit: 0 detached, or the shell's own exit · 1 the screen closed or failed, or refused before its first frame.
 */
import { ATTACH_KEYS_MS, ATTACH_RESIZE_MS, WHEEL_LINES, FOOTER_COLUMNS, TERMINAL } from './limits.js';

export const SHELL_EXITED = 'the shell exited';

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

const columnsOf = (out) => out.columns || TERMINAL.cols, rowsOf = (out) => out.rows || TERMINAL.rows;

/* The size the pane should have: this terminal less the footer's row. None when the output is not a terminal. */
export const terminalSize = (out = process.stdout) => out.isTTY ? { cols: columnsOf(out), rows: Math.max(1, rowsOf(out) - 1) } : null;

/*
 * This terminal attached until the way out; never returns but by exiting.
 *   doors: { keys(keys), view({ size } | { scroll }), detach() → { handover? }, screen() → the frames as they stream
 *     (a frame with its `lines`, { refused } said in the footer, { closed, handover? }, anything else left) }: each a
 *     promise; screen() rejects with the caller's sentence when the screen cannot be opened.
 *   where: what the footer names; onto: 'agent' or 'shell'; watch: no key sent; self: this attach's id; me: the person
 *     attached, whose lines from any terminal are drawn as they are; kept: what a detach says keeps running;
 *   fail(sentence, code): how this caller says a refusal and exits; ended: its sentence for a screen that ends unclosed.
 */
export async function attachTerminal({ doors, where, onto, watch, self, me = null, kept, fail, ended }) {
  const out = process.stdout, inp = process.stdin;
  const tty = !!out.isTTY;
  const columns = () => columnsOf(out), rows = () => rowsOf(out);

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
  // every way out gives the terminal back, a failure or the screen closing as much as a detach
  process.on('exit', restore);
  // the alternate screen (your shell's screen comes back as it was); the wheel reported (SGR), for the scrollback
  if (tty) out.write('\x1b[?1049h\x1b[2J\x1b[?1000h\x1b[?1006h');
  if (inp.isTTY) inp.setRawMode(true);
  inp.resume();

  /* A line clipped to the terminal's width by its VISIBLE characters: the pane's colours travel as escape sequences
     (the pane is captured with them), which take no column and are kept whole; the colour is reset at the end so
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
    const names = [...new Set((Array.isArray(last?.here) ? last.here : []).filter((h) => h && h.attach !== self).map((h) => String(h.name)))];
    return names.length ? names.join(', ') : 'nobody';
  };
  const footer = () => {
    const up = last?.scrolled ? ` · scrollback: ${last.scrolled.up} of ${last.scrolled.history} rows up, the wheel or Shift-PageDown${watch ? '' : ' or a key'} to come back` : '';
    // on the agent's session your keys share its input with the chat's messages: the footer says you are talking to it
    const mine = watch ? ' · watch' : onto === 'agent' ? ' · typing to the agent' : '';
    const text = ` attached · ${where} · also here: ${others()}${mine}${up} · Ctrl-] to detach${note ? ` · ${note}` : ''} `;
    return `\x1b[7m${clip(text, columns()).padEnd(Math.min(columns(), FOOTER_COLUMNS))}\x1b[0m`;
  };
  /* The lines that fit (the part with the cursor in it; a scrolled view from its top), the footer, then the cursor where
   * the pane has it (hidden while scrolled back). One synchronized update, so a terminal that knows it shows the frame at
   * once, never half drawn; `whole` clears the screen first (after a resize the terminal may have moved what it showed). */
  function draw(f, whole = false) {
    if (f) last = f;
    const height = rows(), cols = columns(), room = Math.max(1, height - 1);
    let s = `${tty ? '\x1b[?2026h' : ''}\x1b[?25l${whole ? '\x1b[2J' : ''}\x1b[H`;
    if (last) {
      const { lines, cursor } = markedLines(last, self, me);
      const top = last.scrolled ? 0 : cursor.y >= room ? cursor.y - room + 1 : 0;
      for (let i = 0; i < room; i++) s += `\x1b[${i + 1};1H${clip(lines[top + i] ?? '', cols)}\x1b[K`;
      s += `\x1b[${height};1H${footer()}`;
      if (!last.scrolled) s += `\x1b[${cursor.y - top + 1};${Math.min(cursor.x, cols - 1) + 1}H\x1b[?25h`;
    } else s += `\x1b[${height};1H${footer()}\x1b[?25h`;
    out.write(s + (tty ? '\x1b[?2026l' : '\n'));
  }

  // ---------- keys and scrolls: sent in order, batched every ATTACH_KEYS_MS ----------

  let pending = '', scrollBy = 0, timer = null, sending = Promise.resolve();
  const flush = () => {
    timer = null;
    const keys = pending, scroll = scrollBy;
    pending = ''; scrollBy = 0;
    if (keys) sending = sending.then(() => doors.keys(keys)).catch(() => {});
    if (scroll) sending = sending.then(() => doors.view({ scroll })).catch(() => {});
    return sending;
  };

  // the terminal changed size: drawn again whole at once from the last frame, and the new size said (the pane follows; a
  // window dragged wider says many sizes in a row: the last one, ATTACH_RESIZE_MS after the others stop)
  let resized = null;
  if (tty) out.on('resize', () => {
    draw(null, true);
    clearTimeout(resized);
    resized = setTimeout(() => { sending = sending.then(() => doors.view({ size: terminalSize(out) })).catch(() => {}); }, ATTACH_RESIZE_MS);
  });

  /* What the terminal sent, less the view's own gestures: the wheel (SGR mouse reports; a click is dropped, never sent to
   * the pane) and Shift-PageUp / Shift-PageDown scroll this view, WHEEL_LINES rows a notch, a screen less one a page. */
  const page = () => Math.max(1, rows() - 2);
  const gestures = (s) => s
    .replace(/\x1b\[<(\d+);\d+;\d+[Mm]/g, (_, b) => { const n = Number(b); if (n & 64) scrollBy += (n & 3) === 0 ? WHEEL_LINES : (n & 3) === 1 ? -WHEEL_LINES : 0; return ''; })
    .replace(/\x1b\[5;2~/g, () => { scrollBy += page(); return ''; })
    .replace(/\x1b\[6;2~/g, () => { scrollBy -= page(); return ''; });

  let leaving = false;
  /* The detach is answered with whether this was the last one out (the handover written). */
  async function detach(code = 0) {
    if (leaving) return;
    leaving = true;
    if (timer) clearTimeout(timer);
    await flush();
    const d = await doors.detach();
    restore();
    console.log(`\n  detached · ${kept}${afterDetach(d?.handover)}\n`);
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
    if ((pending || scrollBy) && !timer) timer = setTimeout(flush, ATTACH_KEYS_MS);
    if (at >= 0) void detach(0);
  });
  process.on('SIGTERM', () => void detach(0));
  process.on('SIGHUP', () => void detach(0));

  // ---------- the screen, as it streams ----------

  draw();
  try {
    for await (const f of doors.screen()) {
      if (Array.isArray(f?.lines)) draw(f);
      else if (typeof f?.refused === 'string') { note = f.refused; draw(); }
      else if (typeof f?.closed === 'string' && !leaving) {
        leaving = true; restore();
        // the shell's own exit (exit, Ctrl-D) is a way out: what runs keeps running, the next attach starts a new shell
        if (onto === 'shell' && f.closed === SHELL_EXITED) { console.log(`\n  detached · ${SHELL_EXITED} · ${kept}${afterDetach(f.handover)}\n`); process.exit(0); }
        // closed before its first frame: the attach was refused: its sentence
        if (!last) fail(f.closed, 1);
        console.log(`\n  detached · ${where} closed the attach: ${f.closed}\n`); process.exit(1);
      }
    }
  } catch (e) {
    if (!leaving) { restore(); fail(e.message, 1); }
  }
  if (!leaving) { restore(); fail(ended, 1); }
}
