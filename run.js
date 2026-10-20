#!/usr/bin/env node
/* atelier run — runs a command next to the app. On a remote that means: inside
 * the computer's runtime, as the app's own user, in the released code, with
 * the app's data/, settings and secrets.
 *
 *   atelier run [-r remote] [--tty | --no-tty] -- command [args…]
 *
 *   remote: running as notes, beside its data
 *   2 rows moved to "Client visits"
 *   remote: done · recorded: Alex, a laptop, 09:52
 *
 * The command runs in the app's clone, HOME its sandbox's home, with its
 * config and ATELIER_DATA (its data/); its output comes as it is written. A
 * run may take at most ten minutes. Every run is in the host's record: who,
 * from where, the command, when, the exit code. Exit: 0 when the command
 * exited 0, 1 when it did not (its code is printed), 2, 3 and 4 as for every
 * verb (ops.js) otherwise.
 *
 * From a terminal (your input and output are both a terminal, or --tty), the
 * command gets a terminal of its own on the computer, the size of yours, as
 * ssh -t gives one: a full-screen program (top, an editor, a REPL) draws,
 * every key goes to it as you type it (Ctrl-C too), and a resize follows
 * yours. Ctrl-] leaves: the command's terminal is closed with it. Otherwise
 * (a pipe, a file, --no-tty) what you type or pipe in goes to its input line
 * by line, and its end is the command's end of input. Inside a sandbox the
 * command gets no input and no terminal.
 */
import { failer, whereOf, runOp, inSandbox } from './ops.js';
import { readArgs, helpOf, REMOTE } from './args.js';

const SPEC = {
  usage: 'atelier run [-r remote] [--tty | --no-tty] -- command [args…]',
  options: [REMOTE, { flag: '--tty', help: 'a terminal of its own on the computer' }, { flag: '--no-tty', help: 'no terminal: what you type or pipe in goes in line by line' }],
  rest: true,
};
const fail = failer('run');
const { opts, rest: argv } = readArgs(process.argv.slice(2), SPEC, fail);
if (opts.tty && opts.noTty) fail(`--tty or --no-tty, not both\n\n${helpOf(SPEC)}`);
if (!argv.length) fail(`which command? atelier run -r atelier -- node fix.js\n\n${helpOf(SPEC)}`);
const where = whereOf(opts.remote ?? null, fail, 'run');
// a terminal of its own: asked, refused, or (neither) when this one's input and output are a terminal; never in a sandbox
const tty = !inSandbox() && (opts.tty || (!opts.noTty && !!process.stdin.isTTY && !!process.stdout.isTTY));

const DETACH = '\x1d';   // Ctrl-]: the way out that is no key of the program's
const raw = tty && !!process.stdin.isTTY;
const sizeNow = () => ({ cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
/* The terminal as it was: raw mode off, the cursor shown, the colours reset (a program cut short may leave them). */
let given = false;
const giveBack = () => { if (raw && !given) { given = true; try { process.stdin.setRawMode(false); } catch {} process.stdout.write('\x1b[0m\x1b[?25h'); } };
// whatever way it ends (a signal, a failure that exits): the terminal back as it was
process.once('exit', giveBack);

const code = await runOp('run', where, { verb: 'run', argv, ...(tty ? { tty: true } : {}) }, tty ? {
  // in raw mode a newline does not return the carriage: the computer's own lines end with both
  onFrame: (f) => {
    if (typeof f.line === 'string') process.stderr.write(`remote: ${f.line}${raw ? '\r\n' : '\n'}`);
    if (typeof f.out === 'string') process.stdout.write(f.out);
  },
  // the size first (the program's first frame is drawn at it), then every key as typed, and the size again on a resize
  during: (into) => new Promise((done) => {
    let q = into({ size: sizeNow() }).catch(() => {});
    const send = (body) => { q = q.then(() => into(body)).catch(() => {}); };
    if (raw) process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => {
      const cut = d.indexOf(DETACH);
      if (cut < 0) { send({ keys: d }); return; }
      if (cut > 0) send({ keys: d.slice(0, cut) });
      giveBack();
      process.stderr.write('\nleft · the command\'s terminal on the computer is closed\n');
      process.exit(130);
    });
    process.stdout.on('resize', () => send({ size: sizeNow() }));
    process.stdin.on('end', () => done());
    process.stdin.on('error', () => done());
  }),
} : {
  // what is typed or piped in goes to the command's input; its end, the command's end of input
  during: inSandbox() ? undefined : (into) => new Promise((done) => {
    let q = Promise.resolve();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { q = q.then(() => into({ keys: d })).catch(() => {}); });
    process.stdin.on('end', () => { q = q.then(() => into({ eof: true })).catch(() => {}).then(done); });
    process.stdin.on('error', () => done());
  }),
});
giveBack();
process.stdin.destroy();
process.exit(code === 0 ? 0 : 1);
