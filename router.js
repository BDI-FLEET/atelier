/* atelier · the router a module's backend is given, the same in the shell (server.js), in a backend's own process
 * (backend-host.js) and in a computer's serving sandbox (module-serve.js).
 *
 * A module mounts at `/api/<ws>/<id>`: `scope(prefix)` hands it get/post/put/delete/patch taking paths relative to
 * that prefix (`/spaces`, `''` or `/` for the prefix itself), with `:name` params. First match wins. A handler gets
 * `req.params`, `req.query`, `req.json()` (read once, shared by every reader of the request) and
 * `res.json(data, status?)`; a throw answers its `statusCode` (else 500) with `{ error }`.
 */

import { MAX_JSON_BODY } from './limits.js';

/** A module's id, and a workspace's name. */
export const MODULE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** The header a host (or a computer) sets with who is calling, as it verified them. */
export const CALLER_HEADER = 'x-atelier-caller';

/** The header the shell sets on a request it forwards to a backend's process: what it decided about the request. */
export const SHELL_HEADER = 'x-atelier-shell';

/** A header carrying one JSON object as base64url (or base64): the object, or null when it is not one. */
export function headerObject(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

const status = (message, statusCode) => Object.assign(new Error(message), { statusCode });

/**
 * The request's body as JSON. A body is JSON only when the request says so (content-type application/json): any
 * other body is refused 415, so a text/plain or form body another page sent is never data for a handler. Past
 * MAX_JSON_BODY it is refused 413 and the rest is not kept. No body reads as {}.
 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const hasBody = req.headers['content-length'] !== '0' && (req.headers['content-length'] || req.headers['transfer-encoding']);
    if (hasBody && !/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) {
      req.resume();
      reject(status('the body is JSON: content-type application/json', 415));
      return;
    }
    let body = '';
    let size = 0;
    let over = false;
    req.on('data', (chunk) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        over = true;
        reject(status(`request body exceeds ${MAX_JSON_BODY} bytes`, 413));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (over) return;
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** The body, read once: the gate's `authorize` and the module's handler share one parse. */
export const bodyOf = (req) => (req.__bodyPromise ??= readJsonBody(req));

function compile(pattern) {
  const paramNames = [];
  const re = new RegExp('^' + pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([a-zA-Z_]\w*)/g, (_, n) => { paramNames.push(n); return '([^/]+)'; }) + '$');
  return { re, paramNames };
}

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

export function createRouter() {
  const routes = [];

  /** The routes of one module, under `prefix`; `_dispose()` takes them out again (a hot swap). */
  function scope(prefix) {
    const mine = [];
    const join = (p) => (!p || p === '/') ? prefix : prefix + (p.startsWith('/') ? p : '/' + p);
    const s = Object.fromEntries(METHODS.map((m) => [m, (p, handler) => {
      const entry = { method: m.toUpperCase(), ...compile(join(p)), handler };
      routes.push(entry);
      mine.push(entry);
    }]));
    s._dispose = () => {
      for (const e of mine) { const i = routes.indexOf(e); if (i >= 0) routes.splice(i, 1); }
      mine.length = 0;
    };
    return s;
  }

  /** Runs the first route that matches; false when none does (the caller answers). `run` wraps the handler. */
  async function handle(req, res, run = (fn) => fn()) {
    const url = new URL(req.url, 'http://localhost');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      req.params = Object.fromEntries(r.paramNames.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      req.query = Object.fromEntries(url.searchParams.entries());
      req.json = () => bodyOf(req);
      res.json = (data, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      await run(async () => {
        try {
          await r.handler(req, res);
        } catch (err) {
          const code = err.statusCode || 500;
          if (!res.writableEnded) {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
          if (code >= 500) console.error(err);
        }
      });
      return true;
    }
    return false;
  }

  return { scope, handle, get size() { return routes.length; } };
}
