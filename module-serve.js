#!/usr/bin/env node
// One module, headless: the process a host's computer runs for a module in a serving sandbox (one process, its own
// data/). Internal, not a user verb; the computer starts it:
//
//   node <atelier>/module-serve.js <module dir> --id <id> --socket <path> [--data <dir>] [--workspace global]
//
// It serves, on one unix socket, what a local instance serves for that module and nothing else:
//   • its API, /api/<workspace>/<id>/…, through the module's own mountRoutes(router, ctx) with the same router a local
//     instance gives (scoped paths, :params, req.json(), res.json(), a teardown it may return);
//   • its frontend, /modules/<workspace>/<id>/…, built once at the start by build.js: `frontend.js` (from frontend.jsx,
//     served as .js as a local instance does) and the module's files it imports by a relative path, transitively; and the
//     files under the module's `assets/` folder. Nothing else of the folder leaves the sandbox: not backend.js, not a
//     backend's helpers (db.js, an import script), not data/ or node_modules/, never a dot or underscore name.
//     The frame document, React, the chrome's kit and styles are served at the computer's address, not by the module.
//
// ctx.caller: the X-Atelier-Caller header (base64url JSON), the header a hosted instance reads. For a person's frame:
// { person, name, via }, `via` the mount the person came through, { kind: 'person' } (mounted to them) or
// { kind: 'chat', chat, name } (mounted to a chat they are in); for an agent's tool call: { persona, name, sandbox, chat }.
// Only the computer reaches this socket (it lives in the computer's own folder for the sandbox), so the header is its
// word; it is taken off before the module sees the request.
// ctx.call: on an agent's tool call, the call's id from the X-Atelier-Call header, the same when the computer hands the
// call again (its answer lost on the way back), so `run` can do a call's work once; null on any other request. Taken
// off the request as the caller's header is.
// req.json(): a body is read as JSON only when the request says it is JSON (content-type application/json); any other
// body is refused 415. And a body of the three kinds any page may send another origin without asking first (text/plain, a
// form, multipart) is refused 415 before any route runs: a write from another page never reaches a handler.
//
// The module runs in this process: an uncaught throw or a rejection ends it, so a crash is only its own; the computer
// starts it again. A later push replaces the module's folder and the computer starts it again: no hot reload here.
// ctx.broadcast: the events are written to stdout as one JSON line each (`broadcast {…}`), for the computer to carry.
// ctx.port and ctx.host are null: the module has no port of its own, only the socket.
//
// Its tools, the calls an agent gets (module.json `agent: { tools, teaching }`: the calls and one page on when to use
// them): the names module.json declares, each implemented by the backend's `tools(ctx)` export
// ({ <name>: { description, input, run(args) } }, docs/MODULES.md). A name declared and not implemented, or implemented
// and not declared, is reported and not served. Two more paths on the socket, answered before the module's own routes:
//   GET  /api/<ws>/<id>/tools          → { tools: [{ name, description, input }], teaching: <the page's text> | null }
//   POST /api/<ws>/<id>/tools/<name>   { …args } → 200 { result } · 4xx/500 { error }
// A call is an agent's: its caller (X-Atelier-Caller, set by the computer from what the host verified) names the calling
// sandbox, `{ persona, name, sandbox, chat }`; a caller without `sandbox` (a person's frame) is refused 403. `run` reads
// the caller from ctx.caller, as a route does. A module without `agent.tools` has no tools: both paths answer as such.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { getJsx } from './build.js';
import { readModuleJson, TOOL_NAME, BACKEND_FILE, FRONTEND_FILE } from './module-json.js';
import { createRouter, readJsonBody, headerObject, CALLER_HEADER, CALL_HEADER, MODULE_ID } from './router.js';
import { MAX_HEADER_BYTES, STOP_FLUSH_MS, TEACHING_CHARS } from './limits.js';

function args(argv) {
  const o = { dir: null, id: null, socket: null, data: null, workspace: 'global' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') o.id = argv[++i];
    else if (a === '--socket') o.socket = argv[++i];
    else if (a === '--data') o.data = argv[++i];
    else if (a === '--workspace') o.workspace = argv[++i];
    else if (!a.startsWith('--') && !o.dir) o.dir = a;
    else { console.error(`module-serve: unknown ${a}`); process.exit(2); }
  }
  if (!o.dir || !o.socket) { console.error('module-serve <module dir> --id <id> --socket <path> [--data <dir>] [--workspace global]'); process.exit(2); }
  o.dir = path.resolve(o.dir);
  o.id ??= path.basename(o.dir);
  if (!MODULE_ID.test(o.id) || !MODULE_ID.test(o.workspace)) { console.error(`module-serve: "${o.workspace}/${o.id}" is not a module id`); process.exit(2); }
  o.data = path.resolve(o.data ?? path.join(o.dir, 'data'));
  return o;
}

const o = args(process.argv.slice(2));
const qid = `${o.workspace}/${o.id}`;
const say = (line) => console.log(`module-serve · ${qid} · ${line}`);

// a crash is this process's alone: one line, then the exit the computer sees
let stopping = false;
const die = (kind, err) => {
  if (stopping) return;
  stopping = true;
  console.error(`module-serve · ${qid} · ${kind} in this module's backend, so its process ended:\n${(err && err.stack) || String(err)}`);
  process.exit(1);
};
process.on('uncaughtException', (err) => die('an uncaught exception', err));
process.on('unhandledRejection', (r) => die('an unhandled rejection', r instanceof Error ? r : new Error(String(r))));

const declared = readModuleJson(o.dir);
for (const p of declared.problems) console.warn(`  ! ${qid}/module.json: ${p}`);

// ---- the frontend: frontend.jsx, what it imports, and assets/, built once ----
const files = new Map();   // the path after /modules/<ws>/<id>/ → { content, contentType }
const RAW = { '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.woff2': 'font/woff2' };
const SKIP = (name) => /^[._-]/.test(name) || name === 'data' || name === 'node_modules';
/** A file of the module that may leave the sandbox: inside its folder, no part skipped, not the backend, not data/. */
function servable(abs) {
  const rel = path.relative(o.dir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep).some(SKIP) || rel === BACKEND_FILE || abs === o.data || abs.startsWith(o.data + path.sep)) return null;
  try { if (!fs.lstatSync(abs).isFile()) return null; } catch { return null; }   // a symlink is never served
  return rel.split(path.sep).join('/');
}
/** The relative imports of a built or source file: `from './x'`, `import './x'`, `import('./x')`. */
const importsOf = (src) => [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.\.?\/[^'"]+)['"]/g)].map((m) => m[1]);
async function buildFrontend() {
  // frontend.jsx and every module file it imports by a relative path, transitively
  const entry = [FRONTEND_FILE, 'frontend.js'].map((f) => path.join(o.dir, f)).find((f) => fs.existsSync(f));
  const seen = new Set();
  const visit = async (abs) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const rel = servable(abs);
    if (!rel) return;
    const ext = path.extname(abs);
    if (ext !== '.jsx' && ext !== '.js') { if (RAW[ext]) files.set(rel, { content: fs.readFileSync(abs), contentType: RAW[ext] }); return; }
    const built = await getJsx(abs);
    const e = { content: built.content, contentType: built.contentType };
    files.set(rel, e);
    const asJs = rel.replace(/\.jsx$/, '.js');
    if (ext === '.jsx' || !files.has(asJs)) files.set(asJs, e);   // a .jsx wins over its .js, as in a local instance
    for (const spec of importsOf(fs.readFileSync(abs, 'utf8'))) {
      const base = path.resolve(path.dirname(abs), spec);
      const hit = [base, base.replace(/\.js$/, '.jsx'), `${base}.jsx`, `${base}.js`].find((f) => fs.existsSync(f) && servable(f));
      if (hit) await visit(hit);
    }
  };
  if (entry) await visit(entry);
  // assets/: the module's static files, as they are
  const assets = path.join(o.dir, 'assets');
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      const rel = servable(abs), ext = path.extname(e.name);
      if (rel && RAW[ext]) files.set(rel, { content: fs.readFileSync(abs), contentType: RAW[ext] });
    }
  };
  walk(assets);
}

// ---- the router: the one a local instance gives a module ----
const requestStore = new AsyncLocalStorage();
const prefix = `/api/${o.workspace}/${o.id}`;
const router = createRouter();

/** Who calls and, on a tool call, the call's id: both headers taken off the request. */
function askedOf(req) {
  const raw = req.headers[CALLER_HEADER], call = req.headers[CALL_HEADER];
  delete req.headers[CALLER_HEADER];
  delete req.headers[CALL_HEADER];
  return { caller: headerObject(raw), call: typeof call === 'string' && call ? call : null };
}

const slots = new Map();
const ctx = {
  id: o.id, name: o.id, workspace: o.workspace, qualifiedId: qid, label: null, port: null, host: null,
  baseUrl: process.env.BASE_URL || null, dataDir: o.data,
  log: (...a) => console.log(`[${qid}]`, ...a),
  broadcast: (event) => console.log(`broadcast ${JSON.stringify(event || {})}`),
  module: (id) => { if (!slots.has(id)) slots.set(id, {}); return slots.get(id); },
};
Object.defineProperty(ctx, 'caller', { enumerable: true, get: () => requestStore.getStore()?.caller ?? null });
Object.defineProperty(ctx, 'call', { enumerable: true, get: () => requestStore.getStore()?.call ?? null });

const SIMPLE = /^(text\/plain|application\/x-www-form-urlencoded|multipart\/form-data)\b/i;
async function handle(req, res) {
  const asked = askedOf(req), { caller } = asked;
  if (req.method !== 'GET' && req.method !== 'HEAD' && SIMPLE.test(String(req.headers['content-type'] ?? ''))) {
    req.resume();
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'the body is JSON: content-type application/json' }));
    return;
  }
  const url = new URL(req.url, 'http://module');
  const p = url.pathname;
  if (req.method === 'GET' && p.startsWith(`/modules/${qid}/`)) {
    let rel;
    try { rel = decodeURIComponent(p.slice(`/modules/${qid}/`.length)); } catch { rel = ''; }
    const f = files.get(rel);
    if (!f) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': f.contentType, 'Cache-Control': 'no-cache' });
    res.end(f.content);
    return;
  }
  if (p === `${prefix}/tools` || p.startsWith(`${prefix}/tools/`)) {
    if (await toolRequest(req, res, p, asked)) return;
  }
  req.user = null;
  req.caller = caller;
  if (await router.handle(req, res, (fn) => requestStore.run({ caller, call: null }, fn))) return;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ---- the tools: the declared ones the backend implements ----
const tools = new Map();   // name → { description, input, run }
const wanted = Array.isArray(declared.declared.agent?.tools) ? declared.declared.agent.tools : [];
let teaching = null;

function loadTools(plug) {
  if (typeof plug?.tools !== 'function' && !wanted.length) return;
  let made = {};
  if (typeof plug?.tools === 'function') {
    try { made = plug.tools(ctx) ?? {}; } catch (err) { console.warn(`  ! ${qid}: tools(ctx) threw, no tools served: ${err.message}`); made = {}; }
  }
  for (const name of wanted) {
    const t = made[name];
    if (!t || typeof t.run !== 'function') { console.warn(`  ! ${qid}: module.json declares the tool ${name}; backend.js tools(ctx) does not implement it, not served`); continue; }
    tools.set(name, { description: typeof t.description === 'string' ? t.description : '', input: t.input && typeof t.input === 'object' ? t.input : { type: 'object', properties: {} }, run: t.run });
  }
  for (const name of Object.keys(made)) if (!wanted.includes(name)) console.warn(`  ! ${qid}: backend.js implements the tool ${name}; module.json does not declare it, not served`);
  const page = declared.declared.agent?.teaching;
  if (typeof page === 'string' && page) {
    const file = path.resolve(o.dir, page);
    if (!file.startsWith(o.dir + path.sep)) console.warn(`  ! ${qid}/module.json: the teaching ${page} is outside the module, ignored`);
    else try { teaching = fs.readFileSync(file, 'utf8').slice(0, TEACHING_CHARS); } catch { console.warn(`  ! ${qid}/module.json: the teaching ${page} cannot be read, ignored`); }
  }
}

/** A request under /api/<ws>/<id>/tools: answered here (true), or not a tools path after all (false). */
async function toolRequest(req, res, p, asked) {
  const { caller } = asked;
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (p === `${prefix}/tools`) {
    if (req.method !== 'GET') return false;
    send({ tools: [...tools].map(([name, t]) => ({ name, description: t.description, input: t.input })), teaching });
    return true;
  }
  const name = decodeURIComponent(p.slice(`${prefix}/tools/`.length));
  if (req.method !== 'POST' || !TOOL_NAME.test(name)) return false;
  const t = tools.get(name);
  if (!t) { send({ error: `no tool ${name}` }, 404); return true; }
  if (!caller || typeof caller.sandbox !== 'string' || !caller.sandbox) { send({ error: 'a tool is called by an agent, through its computer' }, 403); return true; }
  let args;
  try { args = await readJsonBody(req); } catch (err) { send({ error: err.statusCode === 413 ? err.message : 'the arguments are not JSON' }, err.statusCode || 400); return true; }
  if (!args || typeof args !== 'object' || Array.isArray(args)) { send({ error: 'the arguments are one JSON object' }, 400); return true; }
  await requestStore.run(asked, async () => {
    try { send({ result: (await t.run(args)) ?? null }); }
    catch (err) {
      const status = err.statusCode || 500;
      send({ error: err.message }, status);
      if (status >= 500) console.error(err);
    }
  });
  return true;
}

// ---- start: the frontend built, the backend mounted, then the socket ----
await buildFrontend();
let teardown = null;
const backend = path.join(o.dir, BACKEND_FILE);
if (fs.existsSync(backend)) {
  const mod = await import(pathToFileURL(backend).href);
  const plug = mod.default;
  if (!plug?.mountRoutes) { console.error(`module-serve · ${qid} · backend.js has no default.mountRoutes export`); process.exit(1); }
  fs.mkdirSync(o.data, { recursive: true });
  const t = plug.mountRoutes(router.scope(prefix), ctx);
  if (typeof t === 'function') teardown = t;
  else if (t && typeof t.then === 'function') t.then((f) => { if (typeof f === 'function') teardown = f; });
  loadTools(plug);
} else if (wanted.length) console.warn(`  ! ${qid}: module.json declares tools and there is no backend.js; none served`);
try { if (fs.lstatSync(o.socket).isSocket()) fs.rmSync(o.socket); } catch {}
// each request to the module's API, one line with its status and time (`atelier logs` shows them, `atelier ps` the last one)
const server = http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => {
  const t0 = Date.now(), p = (req.url || '/').split('?')[0];
  if (p.startsWith('/api/')) res.on('finish', () => console.log(`${new Date().toISOString()} · request · ${req.method} ${p} ${res.statusCode} ${Date.now() - t0}ms`));
  handle(req, res);
});
server.on('error', (err) => { console.error(`module-serve · ${qid} · could not listen on ${o.socket}: ${err.message}`); process.exit(1); });
server.listen(o.socket, () => {
  fs.chmodSync(o.socket, 0o600);
  say(`up · pid ${process.pid} · ${router.size} routes · ${files.size} frontend files · ${tools.size} tools${tools.size ? ` (${[...tools.keys()].join(', ')})` : ''} · ${declared.declared.name ?? o.id}`);
});

const shutdown = () => {
  if (stopping) return;
  stopping = true;
  try { teardown?.(); } catch (err) { console.warn(`  ! ${qid}.teardown: ${err.message}`); }
  server.close();
  try { fs.rmSync(o.socket, { force: true }); } catch {}
  setTimeout(() => process.exit(0), STOP_FLUSH_MS);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
