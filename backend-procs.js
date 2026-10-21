/* atelier · a process per backend: the shell's side (backend-host.js is the process's side).
 *
 * The shell starts each module's backend as its own node process: a module that crashes or loops takes down its own
 * process and nothing else. Each backend.js is bundled by the shell and handed to a fresh node process running
 * backend-host.js, which mounts it with the same router and ctx and listens on a unix socket in a folder only this user
 * can open. The shell proxies the module's `/api/<ws>/<id>/…` lane to that socket and relays its `ctx.broadcast` (IPC)
 * onto the module's real-time topic.
 *
 *   • A crash (an uncaught throw, process.exit, out of memory) ends that process: the shell logs one line, the
 *     module's lane answers 500 with the error, and a fresh process starts after BACKEND_RESTART_FIRST_MS, the wait
 *     doubling up to BACKEND_RESTART_MAX_MS; it starts over once a process has stayed up BACKEND_STEADY_MS.
 *   • A loop: the shell pings every process every BACKEND_PING_MS; one that has not answered for LOOP_MS is killed,
 *     then restarted the same way.
 *   • A save restarts that module's process alone: the new code loads in a new process first; if it fails, the old
 *     one keeps serving. If it loads, the old process tears down, then the new one mounts.
 *
 * The configured auth module (the gate) is the one backend that stays in the shell's process: the shell calls its
 * `authenticate` / `authorize` / `handleUnauth` on every request and `handleUnauth` owns the response. It is the
 * shell's trusted layer, not a feature module.
 *
 * server.js hands `createBackendProcs` what a process is started with (its folder, the instance's settings, the
 * configured auth module, the bundler) and where its news goes (the module's topic, the backend-error state).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { GLOBAL_WORKSPACE } from './discovery.js';
import { CALLER_HEADER, SHELL_HEADER } from './router.js';
import { BACKEND_LOOP_MS, BACKEND_PING_MS, BACKEND_STOP_MS, BACKEND_RESTART_FIRST_MS, BACKEND_RESTART_MAX_MS, BACKEND_STEADY_MS, SOCKET_HASH_CHARS } from './limits.js';

const LOOP_MS = Number(process.env.ATELIER_BACKEND_LOOP_MS || BACKEND_LOOP_MS);
const exitWords = (b, r) => b.crashMessage || `the backend process ended (${r.signal || `exit ${r.code}`})`;

export function createBackendProcs(shell) {
  const { hostDir, auth, label, port, host, baseUrl } = shell;
  const backendProcs = new Map();       // qid → { m, b (current process or null), backoff, upSince, restartTimer, gone }
  const BACKEND_HOST = path.join(hostDir, 'backend-host.js');
  const SOCK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-'));   // 0700: the sockets are the shell's alone
  let sockGen = 0;

  function isGateModule(m) {
    if (!auth || m.workspace !== GLOBAL_WORKSPACE) return false;
    const wantId = path.basename(String(auth));
    return m.qualifiedId === auth || m.qualifiedId === `${GLOBAL_WORKSPACE}/${wantId}` || m.id === wantId;
  }

  // Fork one process for module m and hand it the bundled code. Returns the handle; `wait(types)` resolves with the
  // next message of those types, or { type: 'exit' } if the process ends first.
  function forkBackend(m, code) {
    const socketPath = path.join(SOCK_DIR, `${crypto.createHash('sha1').update(m.qualifiedId).digest('hex').slice(0, SOCKET_HASH_CHARS)}-${++sockGen}.sock`);
    const child = fork(BACKEND_HOST, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const b = { m, child, socketPath, alive: true, crashMessage: null, lastPong: Date.now(), stopping: false, loop: false, onExit: null, _wait: null };
    b.wait = (types) => new Promise((res) => { b._wait = { types, res }; });
    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'broadcast') { shell.broadcast(m.qualifiedId, msg.event || {}); return; }
      if (msg.type === 'pong') { b.lastPong = Date.now(); return; }
      if (msg.type === 'crash') { b.crashMessage = msg.message; return; }
      if (b._wait && b._wait.types.includes(msg.type)) { const w = b._wait; b._wait = null; w.res(msg); }
    });
    child.on('error', () => {});
    child.on('exit', (code, signal) => {
      b.alive = false;
      try { fs.unlinkSync(socketPath); } catch {}
      if (b._wait) { const w = b._wait; b._wait = null; w.res({ type: 'exit', code, signal }); }
      b.onExit?.(code, signal);
    });
    child.send({
      type: 'load',
      code,
      info: {
        id: m.id, workspace: m.workspace, qualifiedId: m.qualifiedId,
        label, port, host, baseUrl,
        dataDir: path.join(m.dir, 'data'), socketPath,
      },
    });
    return b;
  }

  // Bundle and load module m in a new process, not yet mounted. → { b } or { error }
  async function loadBackendProcess(m) {
    let code;
    try { code = await shell.bundle(m); } catch (err) { return { error: err?.message || String(err) }; }
    const b = forkBackend(m, code);
    const r = await b.wait(['loaded', 'load-error']);
    if (r.type === 'loaded') return { b };
    return { error: r.type === 'load-error' ? r.message : exitWords(b, r) };
  }
  // Mount a loaded process: mountRoutes runs, the socket listens. → null, or the error.
  async function mountBackendProcess(b) {
    b.child.send({ type: 'mount' });
    const r = await b.wait(['ready', 'load-error']);
    if (r.type === 'ready') { b.lastPong = Date.now(); return null; }
    return r.type === 'load-error' ? r.message : exitWords(b, r);
  }
  function killBackend(b, signal = 'SIGTERM') {
    if (!b || !b.alive) return;
    b.stopping = true;
    try { b.child.kill(signal); } catch {}
  }
  // Ask a process to tear down and wait for it; SIGKILL after BACKEND_STOP_MS.
  function stopBackend(b) {
    if (!b || !b.alive) return Promise.resolve();
    b.stopping = true;
    return new Promise((res) => {
      const t = setTimeout(() => { try { b.child.kill('SIGKILL'); } catch {} }, BACKEND_STOP_MS);
      b.child.once('exit', () => { clearTimeout(t); res(); });
      try { b.child.send({ type: 'stop' }); } catch { try { b.child.kill('SIGTERM'); } catch {} }
    });
  }

  function adoptBackend(m, b) {
    let e = backendProcs.get(m.qualifiedId);
    if (!e) { e = { m, b: null, backoff: 0, upSince: 0, restartTimer: null, gone: false }; backendProcs.set(m.qualifiedId, e); }
    e.m = m;
    e.b = b;
    e.upSince = Date.now();
    b.onExit = (code, signal) => onBackendExit(e, b, { code, signal });
    return e;
  }

  function onBackendExit(e, b, r) {
    if (b.stopping || e.b !== b || e.gone) return;   // stopped on purpose, or replaced
    e.b = null;
    const qid = e.m.qualifiedId;
    const why = b.loop ? `stopped answering for ${Math.round(LOOP_MS / 1000)} s (a loop?) and was killed` : exitWords(b, r);
    e.backoff = (Date.now() - e.upSince > BACKEND_STEADY_MS || !e.backoff) ? BACKEND_RESTART_FIRST_MS : Math.min(e.backoff * 2, BACKEND_RESTART_MAX_MS);
    shell.setError(qid, b.loop ? `This module's backend ${why}.` : shell.enrichError(why, e.m.dir), 'crash');
    console.error(`  ! ${qid}: backend process ended (${b.loop ? 'no answer, killed' : r.signal || `exit ${r.code}`}) · restarting in ${e.backoff / 1000} s · the rest keeps running`);
    clearTimeout(e.restartTimer);
    e.restartTimer = setTimeout(() => {
      e.restartTimer = null;
      if (e.gone || e.b) return;
      startBackendProcess(e.m, 'restarted').catch((err) => console.error(`  ! restart ${qid}: ${err.message}`));
    }, e.backoff);
  }

  async function startBackendProcess(m, verb = 'mounted') {
    const qid = m.qualifiedId;
    const fail = (raw, b) => {
      killBackend(b, 'SIGKILL');
      const message = shell.enrichError(raw, m.dir);
      console.error(`  ! ${qid}: backend failed to load — ${message}`);
      shell.setError(qid, message, 'load');
      return false;
    };
    const r = await loadBackendProcess(m);
    if (r.error) return fail(r.error);
    const e = backendProcs.get(qid);
    if (e?.gone) { killBackend(r.b, 'SIGKILL'); return false; }
    const err = await mountBackendProcess(r.b);
    if (err) return fail(err, r.b);
    adoptBackend(m, r.b);
    shell.clearError(qid);
    console.log(`  + ${verb} ${qid} backend · pid ${r.b.child.pid}`);
    return true;
  }

  async function reloadBackendProcess(m) {
    const qid = m.qualifiedId;
    const r = await loadBackendProcess(m);
    if (r.error) {
      const message = shell.enrichError(r.error, m.dir);
      if (shell.setError(qid, message, 'load')) console.error(`  ! ${qid}: reload failed, keeping current version — ${message}`);
      return;
    }
    const e = backendProcs.get(qid);
    if (e) { clearTimeout(e.restartTimer); e.restartTimer = null; await stopBackend(e.b); e.b = null; }
    const err = await mountBackendProcess(r.b);
    if (err) {
      killBackend(r.b, 'SIGKILL');
      const message = shell.enrichError(err, m.dir);
      console.error(`  ! ${qid}: reload failed — ${message}`);
      shell.setError(qid, message, 'load');
      return;
    }
    const ne = adoptBackend(m, r.b);
    ne.backoff = 0;
    shell.clearError(qid);
    console.log(`  ↻ reloaded ${qid} backend · pid ${r.b.child.pid}`);
  }

  async function stopBackendProcess(qid) {
    const e = backendProcs.get(qid);
    if (!e) return;
    e.gone = true;
    clearTimeout(e.restartTimer);
    backendProcs.delete(qid);
    await stopBackend(e.b);
  }

  // The watchdog for loops: a process blocked in a loop cannot answer a ping.
  setInterval(() => {
    const now = Date.now();
    for (const e of backendProcs.values()) {
      const b = e.b;
      if (!b || !b.alive || b.stopping) continue;
      if (now - b.lastPong > LOOP_MS) { b.loop = true; try { b.child.kill('SIGKILL'); } catch {} continue; }
      try { b.child.send({ type: 'ping' }); } catch {}
    }
  }, BACKEND_PING_MS).unref();

  // The module's lane, forwarded to its process. `decided` is what the shell decided about the request (the user the
  // gate resolved, the caller); it rides on a header only the shell sets, on a socket only the shell can open.
  async function proxyToBackend(req, res, e, decided) {
    const qid = e.m.qualifiedId;
    const b = e.b;
    if (!b || !b.alive) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'backend restarting', module: qid }));
      return;
    }
    const headers = { ...req.headers };
    delete headers[CALLER_HEADER];
    headers[SHELL_HEADER] = Buffer.from(JSON.stringify(decided)).toString('base64');
    // The gate's `authorize` may have read the body already (bodyOf memoizes it): send what it parsed.
    let body = null;
    if (req.__bodyPromise) {
      try { body = Buffer.from(JSON.stringify(await req.__bodyPromise)); } catch { body = Buffer.from('{}'); }
      headers['content-length'] = String(body.length);
      delete headers['transfer-encoding'];
    }
    // A body the module stopped reading (a 413) is drained here, as the in-process router did, so the connection stays
    // usable for the browser's next request.
    const drain = () => { if (!req.complete) { req.unpipe(preq); req.resume(); } };
    const preq = http.request({ socketPath: b.socketPath, method: req.method, path: req.url, headers }, (pres) => {
      res.writeHead(pres.statusCode, pres.statusMessage, pres.headers);
      pres.pipe(res);
      pres.on('end', drain);
    });
    preq.on('error', () => {
      drain();
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'backend unreachable', module: qid }));
      } else if (!res.writableFinished) res.destroy();
    });
    res.on('close', () => { if (!res.writableFinished) preq.destroy(); });
    if (body) preq.end(body);
    else req.pipe(preq);
  }

  return {
    /** Whether module m's backend runs as its own process: every backend but the configured auth module's. */
    runsApart: (m) => !isGateModule(m),
    start: startBackendProcess,
    reload: reloadBackendProcess,
    stop: stopBackendProcess,
    /** The modules that have a process, by qualified id. */
    ids: () => backendProcs.keys(),
    has: (qid) => backendProcs.has(qid),
    /** Forwards the module's lane to its process, with what the shell decided: { user, caller }. */
    proxy: (req, res, qid, decided) => proxyToBackend(req, res, backendProcs.get(qid), decided),
    /**
     * Stops every process at shutdown: SIGTERM, which their host turns into the module's teardown and an exit. (Should
     * the shell die without this, each process sees its IPC channel close and tears down the same way.) → how many
     * were running.
     */
    stopAll() {
      const running = [...backendProcs.values()].filter((e) => e.b?.alive).length;
      for (const e of backendProcs.values()) { e.gone = true; clearTimeout(e.restartTimer); killBackend(e.b, 'SIGTERM'); }
      try { fs.rmSync(SOCK_DIR, { recursive: true, force: true }); } catch {}
      return running;
    },
  };
}
