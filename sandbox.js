/* atelier · inside a sandbox: the computer's socket, the one way out a program
 * in a sandbox has. An agent runs atelier push inside its sandbox with no
 * session and no token; it can only speak to the computer over the socket.
 *
 * A sandbox's processes are started with ATELIER_SOCKET (where the socket is)
 * and ATELIER_SANDBOX (which sandbox it says it is). The socket speaks JSON
 * lines: a `hello { sandbox, cwd }` first (the computer checks who is
 * calling), then one request per line, each answered on one line with its id.
 *
 * Kept free of packages (node builtins and limits.js only).
 */
import net from 'node:net';
import { SOCKET_ANSWER_MS } from './limits.js';

/* In a sandbox: both variables set. Then the CLI asks the socket, never a session. */
export const inSandbox = () => !!(process.env.ATELIER_SOCKET && process.env.ATELIER_SANDBOX);

/* One request after the hello. Answers the socket's answer, or { refused } when
 * the socket cannot be reached or refuses the hello. A verb that streams (push)
 * sends `{ line }` lines before its answer: each goes to `onLine` as it comes,
 * and the wait starts again with each one. An op (logs, run, …) sends `{ line }`
 * (the computer's words) and `{ out }` (output as it came): each frame goes to
 * `onFrame` when given. */
export function askSocket(request, { timeoutMs = SOCKET_ANSWER_MS, onLine, onFrame } = {}) {
  return new Promise((resolve) => {
    const c = net.connect(process.env.ATELIER_SOCKET);
    let buf = '', done = false;
    const end = (a) => { if (done) return; done = true; clearTimeout(t); c.destroy(); resolve(a); };
    const late = () => end({ refused: 'the computer did not answer in time' });
    let t = setTimeout(late, timeoutMs);
    c.setEncoding('utf8');
    c.once('error', (e) => end({ refused: `the computer's socket cannot be reached: ${e.code || e.message}`, unreachable: true }));
    c.once('connect', () => c.write(JSON.stringify({ id: 1, verb: 'hello', sandbox: process.env.ATELIER_SANDBOX, cwd: process.cwd() }) + '\n'));
    c.on('data', (d) => {
      buf += d;
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        let a;
        try { a = JSON.parse(buf.slice(0, nl)); } catch { a = null; }
        buf = buf.slice(nl + 1);
        if (!a) continue;
        if (a.id === 1) {
          if (!a.ok) return end({ refused: a.refused || 'the computer refused the hello' });
          c.write(JSON.stringify({ ...request, id: 2 }) + '\n');
        } else if (a.id === 2 && (typeof a.line === 'string' || typeof a.out === 'string') && a.ok === undefined && a.refused === undefined) {
          clearTimeout(t); t = setTimeout(late, timeoutMs);
          if (onFrame) onFrame(a); else if (typeof a.line === 'string') onLine?.(a.line);
        } else if (a.id === 2) { const { id: _, ...rest } = a; return end(rest); }
      }
    });
    c.once('close', () => end({ refused: 'the computer closed the socket' }));
  });
}
