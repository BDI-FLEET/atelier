#!/usr/bin/env node
/* atelier push — makes the app live: a git push whose answer is printed in
 * your terminal.
 *
 *   atelier push [remote] [commit]
 *
 *   remote: -----> reading-list: building 9c04e1f
 *   remote: -----> runtime started
 *   remote: -----> live: reading-list @ 9c04e1f
 *   in your sidebar on the portal
 *
 * In a module folder. push takes the remote as a plain argument, as git push
 * does, and uses the remote named atelier when none is given; the commit is
 * HEAD unless named (going back is a push of an older commit: `atelier push
 * atelier 81d07e4`), and it becomes the receiver's main whatever was there.
 *
 * 1 · the remote's URL (<host>/git/<computer>/<module>.git) says the host, the
 *     computer and the app;
 * 2 · the host mints a token for one push, one module, five minutes
 *     (POST /api/push/token { computer, module }, your session), answering the
 *     URL to push to;
 * 3 · git pushes there over HTTP as user `atelier` with the token as the
 *     password (repo.js gitWithToken). The token is never in argv, a file,
 *     the shell history or the output.
 * 4 · git's output passes through unchanged; the receiver's lines arrive as
 *     `remote: …` as it prints them.
 *
 * Inside a sandbox (ATELIER_SOCKET and ATELIER_SANDBOX set, as a sandbox's
 * processes are started): there is no session and no token. Steps 2 and 3 are
 * the computer's: the CLI asks the computer's socket `push { module, remote,
 * commit }`; the computer vouches for the sandbox, the host mints the token on
 * the sandbox's own maintain grant and hands it to the computer, which runs
 * the git push itself from this checkout and streams git's lines back. The
 * token never reaches the agent: it sees the remote: lines and nothing else.
 * The CLI prints those lines and reads the same verdict from them. What a
 * person can do from a laptop, an agent can do from its chat's computer, and
 * the host's record shows which of them did what.
 *
 * Exit, the same for every verb: 0 git succeeded and the receiver's last
 * `----->` line is `live: <module> @ <the commit pushed>` (or git found the
 * commit to be the receiver's main already: one line, "<module> @ <commit> is live already") · 1 the host
 * refused or the work failed, nothing half-done · 2 written wrongly, outside a
 * module folder, or no such remote · 3 not signed in at the remote's host ·
 * 4 signed in, but the grant is missing (the host's sentence names it).
 */
import { inSandbox, askSocket } from './sandbox.js';
import { DEFAULT_REMOTE, git, gitToken, gitWithToken } from './repo.js';
import { failer, sessionAt, socketAnswer, whereOf } from './ops.js';
import { readArgs } from './args.js';
import { PUSH_QUIET_MS, SHORT_SHA_CHARS } from './limits.js';

const SPEC = {
  usage: 'atelier push [remote] [commit]',
  words: [['remote', `a git remote of this module (default: ${DEFAULT_REMOTE})`], ['commit', 'what goes live (default: HEAD); an older commit is how one goes back']],
  most: 2,
};
const fail = failer('push');

const { words: [remote = DEFAULT_REMOTE, commit = 'HEAD'] } = readArgs(process.argv.slice(2), SPEC, fail);

const where = whereOf(remote, fail, 'push');
const sha = git(where.dir, ['rev-parse', '--verify', '-q', `${commit}^{commit}`]).out;
if (!/^[0-9a-f]{40,64}$/.test(sha)) fail(`"${commit}" isn't a commit of this repository`);
// what git names on its last line (`main -> main`): the branch when one is meant, else the commit itself
const branch = commit === 'HEAD' ? git(where.dir, ['symbolic-ref', '-q', 'HEAD']).out
  : git(where.dir, ['rev-parse', '--verify', '-q', `refs/heads/${commit}`]).code === 0 ? `refs/heads/${commit}` : '';
const source = branch && git(where.dir, ['rev-parse', '--verify', '-q', branch]).out === sha ? branch : sha;

const { host, computer, module } = where;

/* What git said, read for the verdict: the receiver's last ----> line names the commit pushed. */
function verdict(code, said) {
  const remoteLines = said.split(/\r?\n|\r/).map((l) => /^remote: ?(.*)$/.exec(l)?.[1]).filter((l) => l !== undefined);
  const steps = remoteLines.map((l) => /^----->\s+(.*)$/.exec(l.trim())?.[1]).filter(Boolean);
  const live = /^live: (\S+) @ ([0-9a-f]{4,64})\b/.exec(steps.at(-1) || '');
  if (code === 0 && live && live[1] === module && sha.startsWith(live[2])) {
    if (!remoteLines.some((l) => l.includes('in your sidebar on the portal'))) console.log('in your sidebar on the portal');
    process.exit(0);
  }
  // the commit is the receiver's main already: git said so, and only an accepted push moves it
  if (code === 0 && !remoteLines.length && /Everything up-to-date/.test(said)) { console.log(`${module} @ ${sha.slice(0, SHORT_SHA_CHARS)} is live already`); process.exit(0); }
  if (code === 0) fail(`the receiver did not say ${module} is live on ${sha.slice(0, SHORT_SHA_CHARS)}`, 1);
  process.exit(1);
}

if (inSandbox()) {
  // inside a sandbox: no session, no token. The computer pushes from this checkout with a token the host hands to it
  // alone, and streams git's lines back; they are printed as git prints them
  let said = '';
  const a = await askSocket({ verb: 'push', module, remote, commit: sha }, { timeoutMs: PUSH_QUIET_MS,
    onLine: (line) => { process.stderr.write(`${line}\n`); said += `${line}\n`; } });
  verdict(socketAnswer(a, fail, 'push'), said);
}

// the session at the remote's host, a token for this one push, and git pushing with it; the remote lines kept for the verdict
const { session } = sessionAt(host, fail);
const { url: target, token } = await gitToken('push', host, session, { computer, module }, fail, `the grant is missing: maintain on ${computer}`);
let said = '';
const code = await gitWithToken('push', target, token, { after: [`+${source}:refs/heads/main`], cwd: where.dir, onStderr: (d) => { said += d; } }, fail);
verdict(code, said);
