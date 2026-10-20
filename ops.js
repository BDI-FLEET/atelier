/* atelier · the maintain verbs' client, shared by logs, ps, restart, run,
 * config, data, files and agent. Every verb that names a remote reaches the
 * live app through the host, which checks on each call that the caller may do
 * it.
 *
 * From a laptop (your session for the remote's host):
 *   POST /api/ops { computer, module?, workspace?, op, machine }  → 201 { op }
 *   GET  /api/ops/<id>/stream   JSON lines: { started }, { line }, { out }, … { done, code }
 *   POST /api/ops/<id>/in       what goes into the op once it started: a run's
 *                               input, config values, data and files in pieces
 * Inside a sandbox (ATELIER_SOCKET and ATELIER_SANDBOX set): no session; the
 * socket's `op { computer, module, op, … }`: the computer asks the host for it
 * as the sandbox and streams the same { line } and { out } back.
 *
 * What the computer says in its own words ({ line }) is printed as
 * `remote: …` on stderr, as git prints a receiver's lines; output ({ out }, a
 * run's, the log's) as it came, on stdout.
 *
 * Exit, the same for every verb: 0 done · 1 the host refused or the work
 * failed (a run whose command failed) · 2 written wrongly, outside a module
 * folder, no such remote · 3 not signed in at the remote's host · 4 signed
 * in, but the grant is missing (the host's sentence names it).
 *
 * Kept dependency-free (node builtins + global fetch).
 */
import os from 'node:os';
import { readCredentials, askHost, sessionFor, sentenceOf, notSignedIn, unreachable, hostAnswer, exitOfRefusal } from './session.js';
import { inSandbox, askSocket } from './sandbox.js';
import { DEFAULT_REMOTE, moduleHere, parseRemote, remoteOf } from './repo.js';
import { readArgs, REMOTE } from './args.js';
import { OP_QUIET_MS, OP_FOLLOW_MS, MACHINE_NAME_CHARS } from './limits.js';

export { inSandbox };

/* A verb's failure: one sentence, the exit code. */
export const failer = (name) => (msg, code = 2) => { console.error(`\natelier ${name}: ${msg}\n`); process.exit(code); };

/* Where an app lives: this module folder's remote → { host, computer, module }. Without -r the verb would act on your
 * own instance, which the CLI does not do: it says so in one line and names the -r form. */
export function whereOf(remote, fail, verb) {
  if (remote === null) fail(`without -r it acts on your own instance, which this CLI does not do · atelier ${verb} -r ${DEFAULT_REMOTE}`, 1);
  const mod = moduleHere();
  if (!mod) fail('not in a module folder: a git repository with a module.json (atelier create makes one)');
  const url = remoteOf(mod.dir, remote);
  const where = url && parseRemote(url);
  if (!where) fail(`remote "${remote}" not set: atelier remote <computer>${remote === DEFAULT_REMOTE ? '' : ` --name ${remote}`}`);
  return { ...where, dir: mod.dir };
}

/* What is stored for a host ({ session, person, … }) when it holds a session, or exit 3. */
export function sessionAt(host, fail) {
  const entry = sessionFor(readCredentials(), host);
  if (!entry) fail(notSignedIn(host), 3);
  return entry;
}

/* The computer's answer on the socket: its code, or the verb fails with the computer's sentence, its exit from the
 * refusal's status as from the host's (1 when the socket cannot be reached or the refusal has no status). */
export function socketAnswer(a, fail, what) {
  if (a.unreachable) fail(a.refused, 1);
  if (typeof a.refused === 'string') fail(a.refused, exitOfRefusal(a.status));
  if (!a.ok || typeof a.code !== 'number') fail(`the computer did not say how the ${what} ended`, 1);
  return a.code;
}

/* Print what the computer says: its words as remote: lines, output as it came. */
export const printFrame = (f) => {
  if (typeof f.line === 'string') process.stderr.write(`remote: ${f.line}\n`);
  if (typeof f.out === 'string') process.stdout.write(f.out);
};

/**
 * One op, from wherever this runs. `target`: { host, computer, module?, workspace? }; `op` the verb and its arguments;
 * `during(into)`: what goes into the op once it started, on a laptop (`into(body)` answers the computer's reply);
 * `socket`: what a sandbox hands over on the socket instead (values, prompt, into, from). Answers the exit code of the op.
 */
export async function runOp(name, target, op, { during, socket, onFrame = printFrame, follow = false } = {}) {
  const fail = failer(name);
  if (inSandbox()) {
    const a = await askSocket({ verb: 'op', ...(target.computer ? { computer: target.computer } : {}), ...(target.module ? { module: target.module } : {}),
      ...(target.workspace ? { workspace: target.workspace } : {}), op, ...(socket || {}) },
      { timeoutMs: follow ? OP_FOLLOW_MS : OP_QUIET_MS, onFrame });
    return socketAnswer(a, fail, 'op');
  }
  const { session } = sessionAt(target.host, fail);
  const started = hostAnswer(await askHost(target.host, 'POST', '/api/ops', { session, body: { computer: target.computer,
    ...(target.module ? { module: target.module } : {}), ...(target.workspace ? { workspace: target.workspace } : {}), op, machine: machineName() } }),
  target.host, fail, { ok: 201 });
  if (typeof started.op !== 'string') fail(`the host at ${target.host} started no op`, 1);
  const id = started.op;
  const into = async (body) => {
    const x = await askHost(target.host, 'POST', `/api/ops/${id}/in`, { session, body });
    if (x.status !== 200) throw new Error(sentenceOf(x, `the host answered ${x.status}`));
    return x.body;
  };
  const ac = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { ac.abort(); process.exit(INTERRUPTED); });
  let res;
  try { res = await fetch(`${target.host}/api/ops/${id}/stream`, { headers: { authorization: `Session ${session}`, accept: 'application/x-ndjson' }, signal: ac.signal }); }
  catch { fail(unreachable(target.host), 1); }
  if (res.status !== 200) fail(`the host answered ${res.status} for the op's stream`, 1);
  let buf = '', code = null, side = null;
  const dec = new TextDecoder();
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        let f;
        try { f = JSON.parse(buf.slice(0, nl)); } catch { f = null; }
        buf = buf.slice(nl + 1);
        if (!f) continue;
        if (f.started && during) side = during(into).catch((e) => { process.stderr.write(`remote: ${e.message}\n`); });
        else if (f.done) code = typeof f.code === 'number' ? f.code : 1;
        else if (typeof f.closed === 'string') { process.stderr.write(`remote: ${f.closed}\n`); code = 1; }
        else onFrame(f);
      }
      if (code !== null) break;
    }
  } catch (e) { if (!ac.signal.aborted) fail(`the stream broke: ${e.message}`, 1); }
  ac.abort();
  void side;   // what went in ended before the op did (a run's input may still be open: it is not waited for)
  if (code === null) fail('the computer went quiet before the op ended', 1);
  return code;
}

/* How the host's record names this machine ("from <name>"): ATELIER_MACHINE, else this machine's hostname. */
export const machineName = () => (process.env.ATELIER_MACHINE || os.hostname() || 'a machine').slice(0, MACHINE_NAME_CHARS);

/* A size in words: 812 B, 48.2 kB, 1.8 GB. */
export const sizeWords = (b) => b < 1000 ? `${b} B` : b < 1e6 ? `${(b / 1e3).toFixed(1)} kB` : b < 1e9 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e9).toFixed(1)} GB`;

/* The exit of a verb stopped by Ctrl-C, as a shell reports one ended by SIGINT. */
export const INTERRUPTED = 130;

/* The exit code from an op's code: 0 done, 2 written wrongly, anything else 1. */
export const exitOf = (code) => (code === 0 ? 0 : code === 2 ? 2 : 1);

/* A verb that is one op on the live app with nothing going into it (ps, restart, logs): its options read, the op run,
 * its exit. `op(opts)` is what the op asks; `follow(opts)` whether it streams until Ctrl-C. */
export async function opVerb(name, { usage, options = [], op = () => ({ verb: name }), follow = () => false }) {
  const fail = failer(name);
  const { opts } = readArgs(process.argv.slice(2), { usage, options: [...options, REMOTE] }, fail);
  const stream = follow(opts);
  process.exit(exitOf(await runOp(name, whereOf(opts.remote ?? null, fail, name), op(opts), { follow: stream })));
}
