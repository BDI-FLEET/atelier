#!/usr/bin/env node
/* atelier login — sign in to a host.
 *
 *   atelier login [--host <url>]                                 the way to sign in
 *   atelier login [--host <url>] [--network <network>] <number>  a dev path
 *
 * Without a number, the activation: the host makes a short code for
 * this machine; the CLI opens <host>/activate?code=<code> in the browser, where
 * you are signed in (or sign in first), you Approve, and the waiting command
 * finishes. The screen (login-screen.js): a title, a horse in block characters,
 * the sentence, the link with the code, the code alone, then
 *
 *   waiting … signed in as Alex
 *
 * --no-browser opens nothing; --plain (and any stdout that is no terminal)
 * prints the words only, without colour or the scene.
 *
 * With a number (for dev): the host sends a code to the number, from the
 * agent's number, in a chat where no model answers; you type it at the
 * `code:` prompt (or pass --code).
 *
 * Either way the session the host answers with is kept in
 * ~/.config/atelier/credentials, one entry per host. The default host stays
 * as it is; --host signs in to another one for that call. Signing in
 * says who you are and grants nothing; what you may do is the grants (see
 * `atelier whoami --grants`).
 */
import readline from 'node:readline/promises';
import os from 'node:os';
import fs from 'node:fs';
import { screen, openBrowser, copyText, colourDepth, SCENE_WIDTH } from './login-screen.js';
import { readCredentials, resolveHost, askHost, sessionFor, keepSession, sentenceOf, unreachable, localTime } from './session.js';
import { failer } from './ops.js';
import { readArgs, helpOf, HOST } from './args.js';

const SPEC = {
  usage: 'atelier login [--host <url>] [--no-browser] [--plain] [--network <network>] [<number>]',
  words: [
    ['(no number)', 'opens <host>/activate?code=… in your browser; approve it there (c copies the link)'],
    ['<number>', 'dev: your number, as the messengers know it (+15555550100); a code is sent to it'],
  ],
  options: [
    { flag: '--no-browser', help: 'open nothing; the link and the code are printed' },
    { flag: '--plain', help: 'the words only: no colour, no picture (also when the output is no terminal)' },
    HOST,
    { flag: '--network', value: 'name', help: 'the network the code goes through (default: the one used last on this host, else signal)' },
    { flag: '--code', value: 'code', help: 'the code, without the prompt' },
  ],
  most: 1,
};
const fail = failer('login');

const { opts, words: [number = null] } = readArgs(process.argv.slice(2), SPEC, fail);
const { noBrowser = false, plain = false } = opts;
let { network = null, code = null } = opts;
if (!number && (network || code)) fail(`--network and --code go with a number\n\n${helpOf(SPEC)}`);
if (number && (noBrowser || plain)) fail(`--no-browser and --plain go without a number\n\n${helpOf(SPEC)}`);

const host = resolveHost(opts.host);
if (!number) await activate();
network = network || process.env.ATELIER_NETWORK || sessionFor(readCredentials(), host)?.network || 'signal';

// --code means the code was already sent (an earlier `atelier login`, or the fake network in a test): verify only
if (!code) {
  const asked = await askHost(host, 'POST', '/api/login', { body: { network, number } });
  if (asked.status === 0) fail(unreachable(host), 1);
  if (asked.status < 200 || asked.status >= 300) fail(sentenceOf(asked, `the host at ${host} sent no code (${asked.status})`), 1);
  console.log(`\n  a code was sent to ${number}, from the host, in a chat where no model answers`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { code = (await rl.question('  code: ')).trim(); }
  catch { code = ''; }
  finally { rl.close(); }
  if (!code) fail('no code given', 1);
}

const r = await askHost(host, 'POST', '/api/login/code', { body: { network, number, code } });
if (r.status === 0) fail(unreachable(host), 1);
if (r.status !== 200 || !r.body.session) fail(sentenceOf(r, `the host at ${host} refused the code (${r.status})`), 1);

keepSession(host, r.body, { network, number });
const { person = {} } = r.body;
console.log(`  signed in as ${person.name ?? person.id} · until ${localTime(r.body.expires)} · ${host}\n`);

/* The activation: a code for this machine, approved on the portal's
 * /activate page by you, signed in there. Polled every 2 s for as long as the
 * code lives (10 minutes). The code is shown; the handle the CLI waits with
 * and the session it gets are never printed. */
async function activate() {
  const machine = os.hostname().replace(/\.local$/, '') || 'a machine';
  const made = await askHost(host, 'POST', '/api/activate/new', { body: { machine } });
  if (made.status === 0) fail(unreachable(host), 1);
  if (made.status !== 201 || !made.body.code || !made.body.handle) fail(sentenceOf(made, `the host at ${host} made no code (${made.status})`), 1);
  const { code: shown, handle } = made.body;
  const until = Date.parse(made.body.expires) || Date.now() + 10 * 60_000;
  const link = `${host}/activate?code=${encodeURIComponent(shown)}`;
  // the picture needs its 60 columns: a narrower terminal would wrap every row of it, so it gets the words only
  const art = !plain && !!process.stdout.isTTY && (!process.stdout.columns || process.stdout.columns >= SCENE_WIDTH);
  const keys = !!process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';
  const opened = !noBrowser && openBrowser(link);
  const version = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
  process.stdout.write(screen({ version, host, link, code: shown, opened, canCopy: keys, art, depth: colourDepth() }) + '\n');
  const wait = waiting(art);
  // c copies the link; Ctrl-C ends with one line. Raw mode (needed to read one key) also swallows the terminal's own
  // Ctrl-C, so it is read here as the byte 0x03; SIGINT covers the case without a terminal on stdin.
  const bye = () => { wait.end('stopped: nothing was signed in'); process.exit(130); };
  // a refusal ends the waiting line with its sentence (stdout, beside "waiting …"), exit 1 as every verb's refusal
  const refuse = (msg) => { wait.end(msg); process.exit(1); };
  process.on('SIGINT', bye);
  if (keys) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.on('exit', () => { try { process.stdin.setRawMode(false); } catch {} });
    process.stdin.on('data', (d) => {
      const k = d.toString();
      if (k.includes('\x03')) return bye();
      if (k === 'c' || k === 'C') wait.say(copyText(link) ? 'the link is copied' : 'cannot copy here: no clipboard tool (pbcopy, wl-copy, xclip)');
    });
  }
  for (;;) {
    const r = await askHost(host, 'GET', `/api/activate/${handle}`);
    if (r.status === 200 && r.body.state === 'approved' && r.body.session) {
      keepSession(host, r.body);
      const { person = {} } = r.body;
      wait.end(`signed in as ${person.name ?? person.id}`);
      process.exit(0);
    }
    if (r.status === 200 && r.body.state === 'spent') refuse('this code was used already; run atelier login again');
    if (r.status !== 0 && r.status !== 200) refuse(sentenceOf(r, `the host at ${host} answered ${r.status}`));
    if (Date.now() + 2000 > until) refuse('the code expired; run atelier login again');
    await new Promise((done) => setTimeout(done, 2000));
  }
}

/* The "waiting …" line. On a terminal a small spinner turns at its end and a short note (the c key's answer) may sit
 * beside it; the line is redrawn in place and ends with the outcome. Without a terminal: "waiting … " once, then the
 * outcome on the same line, so a log reads "waiting … signed in as Alex". */
function waiting(art) {
  if (!art) {
    process.stdout.write('waiting … ');
    return { say: (note) => process.stdout.write(`(${note}) `), end: (last) => console.log(last) };
  }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0, note = '';
  const draw = () => process.stdout.write(`\r\x1b[Kwaiting … ${frames[i++ % frames.length]}${note ? `   \x1b[2m${note}\x1b[0m` : ''}`);
  draw();
  const t = setInterval(draw, 100);
  return {
    say: (n) => { note = n; draw(); },
    end: (last) => { clearInterval(t); process.stdout.write(`\r\x1b[Kwaiting … ${last}\n`); },
  };
}
