// The process one module's backend runs in. The shell forks one per module (backend-procs.js, a process per backend),
// hands it the module's bundled backend over IPC, and proxies `/api/<workspace>/<id>/…` to it over a private unix
// socket. The module sees the module contract: `mountRoutes(router, ctx)`, scoped routes, `req.json()`, `res.json()`,
// `req.user`, a teardown it may return, `ctx.broadcast` onto its own real-time topic, and `ctx.caller`.
//
// A crash ends this process and nothing else: an uncaught throw is reported to the shell once, then the process exits.
// The shell logs one line and starts a fresh one with backoff.
//
// Messages, shell → here: load {code, info} · mount · ping · stop
//           here → shell: loaded · load-error {message} · ready · broadcast {event} · pong · crash {message}

import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRouter, headerObject, SHELL_HEADER } from './router.js';
import { MAX_HEADER_BYTES, CRASH_REPORT_MS, STOP_FLUSH_MS } from './limits.js';

const callerStore = new AsyncLocalStorage();
let info = null;          // { id, workspace, qualifiedId, dir, label, port, host, baseUrl, socketPath }
let plug = null;
let teardown = null;
let server = null;
let stopping = false;

const send = (msg, cb) => { try { process.send(msg, cb); } catch { cb?.(); } };

const router = createRouter();

async function handle(req, res) {
  // What the shell decided about this request rides on one header only the shell can set: this socket is private to
  // it. It is taken off before the module sees the request.
  const shell = headerObject(req.headers[SHELL_HEADER]) ?? {};
  delete req.headers[SHELL_HEADER];
  const caller = shell.caller ?? null;
  req.user = shell.user ?? null;
  req.caller = caller;
  if (await router.handle(req, res, (fn) => callerStore.run({ caller }, fn))) return;
  res.writeHead(404);
  res.end('Not found');
}

// ---- ctx: what a module's backend gets, caller included ----
const slots = new Map();
function makeCtx() {
  const ctx = {
    id: info.id,
    name: info.id,
    workspace: info.workspace,
    qualifiedId: info.qualifiedId,
    label: info.label,
    port: info.port,
    host: info.host,
    baseUrl: info.baseUrl,
    dataDir: info.dataDir,
    log: (...args) => console.log(`[${info.qualifiedId}]`, ...args),
    broadcast: (event) => send({ type: 'broadcast', event: event || {} }),
    // A plain object per id, inside this process. Modules share no memory: each backend is its own process.
    module: (id) => { if (!slots.has(id)) slots.set(id, {}); return slots.get(id); },
  };
  // Who is calling, as the shell or its host verified it; read inside a request handler. null outside one.
  Object.defineProperty(ctx, 'caller', { enumerable: true, get: () => callerStore.getStore()?.caller ?? null });
  return ctx;
}

// ---- lifecycle ----
function die(kind, err) {
  if (stopping) return;
  stopping = true;
  const message = `${kind} in this module's backend, so its process ended:\n${(err && err.stack) || String(err)}`;
  const t = setTimeout(() => process.exit(1), CRASH_REPORT_MS);
  send({ type: 'crash', message }, () => { clearTimeout(t); process.exit(1); });
}
process.on('uncaughtException', (err) => die('An uncaught exception', err));
process.on('unhandledRejection', (r) => die('An unhandled rejection', r instanceof Error ? r : new Error(String(r))));

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  try { teardown?.(); } catch (err) { console.warn(`  ! ${info?.qualifiedId}.teardown: ${err.message}`); }
  try { server?.close(); } catch {}
  setTimeout(() => process.exit(code), STOP_FLUSH_MS);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown(0));
process.on('disconnect', () => shutdown(0));   // the shell is gone: tear down, never linger as an orphan

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'ping') { send({ type: 'pong' }); return; }
  if (msg.type === 'stop') { shutdown(0); return; }
  if (msg.type === 'load') {
    info = msg.info;
    try {
      const url = 'data:text/javascript;base64,' + Buffer.from(msg.code).toString('base64');
      const mod = await import(url);
      plug = mod.default;
      if (!plug?.mountRoutes) throw new Error('no default.mountRoutes export');
      send({ type: 'loaded' });
    } catch (err) {
      send({ type: 'load-error', message: err?.message || String(err) }, () => process.exit(0));
    }
    return;
  }
  if (msg.type === 'mount') {
    try {
      // Called as the shell always called it: not awaited. A teardown returned directly counts; an async
      // mountRoutes' teardown is taken when it resolves, and a rejection is an uncaught fault of this process.
      const t = plug.mountRoutes(router.scope(`/api/${info.workspace}/${info.id}`), makeCtx());
      if (typeof t === 'function') teardown = t;
      else if (t && typeof t.then === 'function') t.then((f) => { if (typeof f === 'function') teardown = f; });
    } catch (err) {
      send({ type: 'load-error', message: `mountRoutes threw: ${err?.message || err}` }, () => process.exit(0));
      return;
    }
    server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => { handle(req, res); });
    server.on('error', (err) => send({ type: 'load-error', message: `could not listen: ${err.message}` }, () => process.exit(0)));
    server.listen(info.socketPath, () => send({ type: 'ready' }));
  }
});
