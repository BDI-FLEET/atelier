/* atelier · frames: every module on its own origin.
 *
 * The instance serves the chrome, which shows every module in a frame on its own origin: an app on its own origin
 * cannot read the page, the sidebar or another app. On a laptop a module's origin is `http://<id>.localhost:<port>`
 * (a workspace module: `<id>.<workspace>.localhost`); browsers send every *.localhost name to this machine, and the
 * shell answers on the same port. `frameDomain` names another parent domain for a machine reached by name
 * (`<id>.<frameDomain>`, scheme and port from baseUrl); a wildcard DNS name for it points at the instance.
 *
 * On such a host the shell serves that module and nothing of the shell: the frame document, the frame's runtime
 * (React, frame.js: the module's half of the contract), the chrome's stylesheet built over the chrome's and this
 * module's classes (no other module's), the chrome's kit, the module's own files and API, and a real-time channel
 * carrying only its own topic. Everything else answers 404.
 *
 * server.js hands `createFrames` what it decides with: the settings, the host switch's two answers (whether the
 * host's sidebar names modules, whether the module boundary is in force), and its own functions for modules, the
 * gate, the API lane and assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_WORKSPACE } from './discovery.js';
import { HTTP_PORT } from './limits.js';

// Who may embed a frame: this instance's own page, reached as localhost, 127.0.0.1, [::1] or its baseUrl. A baseUrl on
// a loopback name counts in all three spellings too: a browser on `localhost:<port>` may embed a frame of an instance
// whose baseUrl says `127.0.0.1:<port>`, the same page under another name.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const escHtml = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const hostnameOf = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '');

export function createFrames(shell) {
  const { domain, port, baseUrl, hostDir, observe, remotes, bounded } = shell;
  const FRAME_SUFFIX = '.' + String(domain || 'localhost').toLowerCase();
  const frameLabel = (m) => (m.workspace === GLOBAL_WORKSPACE ? m.id : `${m.id}.${m.workspace}`).toLowerCase();

  function originFor(m) {
    if (!domain) return `http://${frameLabel(m)}.localhost:${port}`;
    const u = new URL(baseUrl);
    return `${u.protocol}//${frameLabel(m)}.${domain}${u.port ? ':' + u.port : ''}`;
  }
  const isFrameHost = (req) => hostnameOf(req.headers.host).endsWith(FRAME_SUFFIX);
  // The same boundary as the page's sidebar: a module that is not this person's is not there. A remote module is one
  // the person's own sidebar names.
  const notTheirs = (user, m) => !m.remote && bounded() && !shell.userModuleSet(user).has(m.qualifiedId);

  // The module a frame host names, from discovery. Two modules with one label (ids differing only in case): neither
  // is framed, rather than the wrong one.
  function frameModuleFor(req) {
    const name = hostnameOf(req.headers.host);
    if (!name.endsWith(FRAME_SUFFIX)) return null;
    const label = name.slice(0, -FRAME_SUFFIX.length);
    const hits = shell.getModules().filter((m) => m.hasFrontend && frameLabel(m) === label);
    return hits.length === 1 ? hits[0] : null;
  }
  // A remote module: under a host, a sidebar entry whose `origin` is a frame host of this instance but no module found
  // here (the module runs elsewhere, on a computer the host reaches). On its origin the shell serves the frame's part,
  // the frame page, React, frame.js, the chrome's stylesheet and kit, and its real-time channel; the module's own paths
  // (`/api/<ws>/<id>/…`, `/modules/<ws>/<id>/…`) are the host's to answer before they reach the shell, and 404 here.
  // Its origin is the app's alone, in the global workspace, whatever workspace of the person's lists it.
  function remoteFrameFor(req, user) {
    if (!remotes || !user) return null;
    const name = hostnameOf(req.headers.host);
    for (const ws of user.workspaces || []) for (const m of ws.modules || []) {
      if (!m.origin) continue;
      let host;
      try { host = new URL(m.origin).hostname.toLowerCase(); } catch { continue; }
      if (host === name) return { qualifiedId: `${GLOBAL_WORKSPACE}/${m.id}`, workspace: GLOBAL_WORKSPACE, id: m.id, remote: true, name: m.meta?.name || m.id };
    }
    return null;
  }
  function parentOrigins() {
    const set = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
    try {
      const u = new URL(baseUrl);
      set.add(u.origin);
      if (LOOPBACK.has(u.hostname) && u.protocol === 'http:') for (const h of LOOPBACK) set.add(`http://${h}:${u.port || HTTP_PORT}`);
    } catch {}
    return set;
  }

  async function frameChromeFor(m) {
    const metaByQId = await shell.getMetaByQId();
    const qid = shell.resolveChromeForQid(metaByQId, m.qualifiedId);
    return qid ? shell.getModules().find((x) => x.qualifiedId === qid) || null : null;
  }

  async function serveFrameDocument(req, res, url, m) {
    const meta = m.remote ? { name: m.name } : await shell.getModuleMeta(m);
    const parents = parentOrigins();
    const asked = url.searchParams.get('atelier-parent');
    const parent = asked && parents.has(asked) ? asked : null;   // the bridge talks to this exact origin, or to nobody
    const chrome = await frameChromeFor(m);
    const hasKit = chrome && (fs.existsSync(path.join(chrome.dir, 'kit.js')) || fs.existsSync(path.join(chrome.dir, 'kit.jsx')));
    const hasStyles = chrome && fs.existsSync(path.join(chrome.dir, 'styles.css'));
    const boot = { qid: m.qualifiedId, workspace: m.workspace, id: m.id, parent, title: meta.name || m.id, observe };
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escHtml(boot.title)}</title>
<style>html{color-scheme:light dark}html,body{margin:0}</style>
${hasStyles ? '<link id="atelier-frame-styles" rel="stylesheet" href="/_frame/styles.css">' : ''}
<style>html,html body,html.dark,html.dark body{background:transparent}</style>
<script src="/_frame/react.js"></script>
<script src="/_frame/react-dom.js"></script>
<script>window.__ATELIER_FRAME__ = ${JSON.stringify(boot).replace(/</g, '\\u003c')};</script>
${hasKit ? `<script type="importmap">${JSON.stringify({ imports: { '@atelier/kit': '/_frame/kit.js' } })}</script>` : ''}
</head>
<body>
<div id="root"></div>
<script type="module" src="/_frame/frame.js"></script>
</body>
</html>`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Only this instance's page may embed the frame.
      'Content-Security-Policy': `frame-ancestors ${[...parents].join(' ')}`,
    });
    res.end(html);
  }

  async function serveFrameHost(req, res, url) {
    let m = frameModuleFor(req);
    const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };
    if (!m && !remotes) return notFound();
    const metaByQId = await shell.getMetaByQId();
    const user = await shell.authenticateRequest(req, res, shell.buildDefaultUser({ metaByQId }));
    if (!user) return;
    // a module that runs elsewhere, framed here because the host's sidebar names this origin for it
    if (!m) m = remoteFrameFor(req, user);
    if (!m) return notFound();
    if (notTheirs(user, m)) return notFound();
    req.user = user;
    const own = `/${m.workspace}/${m.id}`;
    const p = url.pathname;
    const { serveAsset } = shell;
    if (req.method === 'GET' && (p === own || p.startsWith(own + '/'))) return serveFrameDocument(req, res, url, m);
    if (m.remote && (p.startsWith(`/api${own}`) || p.startsWith(`/modules${own}/`))) return notFound();   // the host's
    if (p.startsWith(`/api${own}/`) || p === `/api${own}`) {
      if (!(await shell.serveApiLane(req, res, url, user, metaByQId))) notFound();
      return;
    }
    if (p.startsWith(`/modules${own}/`)) return serveAsset(req, res, url);
    if (p.startsWith('/_frame/')) {
      const name = p.slice('/_frame/'.length);
      if (name === 'react.js' || name === 'react-dom.js') return serveAsset(req, res, url, shell.resolveAssetSource(`/assets/${name}`));
      if (name === 'frame.js') return serveAsset(req, res, url, { kind: 'pinned', src: path.join(hostDir, 'frame.jsx') });
      if (name === 'ws-bridge.js') return serveAsset(req, res, url, { kind: 'pinned', src: path.join(hostDir, 'ws-bridge.js') });
      const chrome = await frameChromeFor(m);
      if (chrome && name === 'styles.css' && fs.existsSync(path.join(chrome.dir, 'styles.css'))) {
        // a remote module's files are not on this machine: its frame gets the chrome's classes only
        return serveAsset(req, res, url, { kind: 'css', src: path.join(chrome.dir, 'styles.css'), scan: [...shell.walkJsxFiles(chrome.dir), ...(m.dir ? shell.walkJsxFiles(m.dir) : [])], key: `frame:${m.qualifiedId}` });
      }
      if (chrome && name === 'kit.js') {
        const kit = ['kit.jsx', 'kit.js'].map((f) => path.join(chrome.dir, f)).find((f) => fs.existsSync(f));
        if (kit) return serveAsset(req, res, url, { kind: 'bundle', src: kit, root: chrome.dir });
      }
    }
    return notFound();
  }

  return {
    originFor,

    /** Where each module this person sees is framed: { qid → its own origin on this machine }. */
    origins(user) {
      const visible = shell.userModuleSet(user);
      return Object.fromEntries(shell.getModules().filter((m) => m.hasFrontend && visible.has(m.qualifiedId)).map((m) => [m.qualifiedId, originFor(m)]));
    },

    /** A request to a module's own origin is answered here: true. Any other host: false, the page's to answer. */
    async serve(req, res, url) {
      if (!isFrameHost(req)) return false;
      await serveFrameHost(req, res, url);
      return true;
    },

    /**
     * The real-time channel's user and module. On a module's own origin the channel carries that module's topic only
     * (a remote module's too: nothing of this instance publishes on it), and a module that is not the person's leaves
     * no user. `gate()` runs the shell's gate. → { user, frameMod } (frameMod null on the page's own origin), or null
     * when the socket is dropped.
     */
    async channel(req, gate) {
      if (!isFrameHost(req)) return { user: await gate(), frameMod: null };
      let frameMod = frameModuleFor(req);
      if (!frameMod && !remotes) return null;
      let user = await gate();
      if (!frameMod) {
        frameMod = remoteFrameFor(req, user);
        if (!frameMod) return null;
      }
      if (user && notTheirs(user, frameMod)) user = null;
      return { user, frameMod };
    },
  };
}
