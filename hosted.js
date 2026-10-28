/* atelier · the host switch: a JS file the host names (`hosted`, ATELIER_HOSTED). When set, the shell trusts the caller
 * header the host sets in front of it, and takes from the file, when it exports them, who the person is
 * (`person(req)`), the sidebar (`sidebar(req, person)`), the host's own pages (`pages`) and what a page gets up front
 * (`handed(req, person)`, the bootstrap's `handed`). Without it: a plain instance, and the caller header is ignored.
 *
 * The sidebar is a list of entries, each a module listed in the workspace it names (the global one when it names none):
 * `{ id, name?, icon?, group?, origin?, workspace? }`. An entry with an `origin` may be listed in any workspace, and in
 * several, an entry in each: its frame lives at its origin's global address, `<origin>/<global>/<id>`, as the app alone
 * in the global workspace there, while the page's address stays the workspace's that lists it. An entry that names a
 * `workspace` and no `id` declares that workspace (`{ workspace, name? }`): the person's workspaces list it, with no
 * modules, and its name when it gives one.
 *
 * The file is loaded once at boot. A host that names a file the shell cannot load stops the start: falling back to
 * "no host" would silently drop who the person is and where the sidebar comes from.
 *
 * The host's own pages (pages are the host's, apps are frames): `pages` maps a path to { title, file, icon?, sidebar?, primary?,
 * workspaces? } (each listed in the sidebar as an entry, in the order given, before the modules, unless sidebar: false;
 * in every workspace, or only in the global one with workspaces: 'global', or only in the others with 'others'; a page
 * lives at /<ws>/<path> in each of those workspaces, listed or not, and host-pages.jsx resolves the address), and the one
 * key `signIn` names the page shown, at whatever path was asked, when person() says nobody. A page is a React component
 * (the file's default export), written like a module frontend: JSX transformed per file, React from the page,
 * `@atelier/kit` from the chrome. It runs in the page itself, inside the chrome's content area, never in a frame. The
 * files live in one folder, served at /_atelier/pages/<name>.js to anyone (the sign-in page loads before a session).
 *
 * server.js hands `loadHost` the shell's functions for the index page, assets and the chrome, and asks the host it gets
 * back for the person and the sidebar (`gate`), the caller, the answer to nobody, its pages and their requests.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePathEntry, GLOBAL_WORKSPACE } from './discovery.js';
import { CALLER_HEADER, MODULE_ID, headerObject } from './router.js';
import { pageAt } from './page-at.js';
import { PAGE_ICON_CHARS } from './limits.js';

const PAGE_ICON = new RegExp(`^[a-z0-9-]{1,${PAGE_ICON_CHARS}}$`);
const PAGE_FILE = /^\/_atelier\/pages\/([a-z0-9-]+)\.js$/;
const PAGE_PATH = /^\/[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9_-]*(?:\/.*)?)?\/?$/;
const RESERVED_PREFIX = /^\/(api|assets|modules|_atelier)\//;
// The workspaces a page may say list it: the global one alone, or every other one.
const PAGE_WORKSPACES = [GLOBAL_WORKSPACE, 'others'];

// → { paths: Map<path, { title, src, icon?, sidebar?, workspaces? }>, signIn: { title, src } | null, dir }
function loadHostPages(pages, base) {
  const out = { paths: new Map(), signIn: null, dir: null };
  for (const [key, def] of Object.entries(pages || {})) {
    if (key !== 'signIn' && !/^\/[a-zA-Z0-9_\-/]*$/.test(key)) throw new Error(`pages: "${key}" is not a path (/…) or signIn`);
    if (!def || typeof def.title !== 'string' || typeof def.file !== 'string') throw new Error(`pages: "${key}" needs { title, file }`);
    const file = resolvePathEntry(def.file, base);
    if (!file || !/\.jsx?$/.test(file) || !fs.existsSync(file)) throw new Error(`pages: "${key}": no .jsx or .js file at ${def.file}`);
    const dir = path.dirname(file), name = path.basename(file).replace(/\.jsx?$/, '');
    if (out.dir && out.dir !== dir) throw new Error(`pages: every page file lives in one folder (${out.dir}, not ${dir})`);
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`pages: "${key}": a file name is a-z, 0-9 and -`);
    out.dir = dir;
    if (def.icon !== undefined && (typeof def.icon !== 'string' || !PAGE_ICON.test(def.icon))) throw new Error(`pages: "${key}": icon is a lucide name (a-z, 0-9, -)`);
    if (def.sidebar !== undefined && typeof def.sidebar !== 'boolean') throw new Error(`pages: "${key}": sidebar is true or false`);
    if (def.primary !== undefined && typeof def.primary !== 'boolean') throw new Error(`pages: "${key}": primary is true or false`);
    if (def.workspaces !== undefined && !PAGE_WORKSPACES.includes(def.workspaces)) throw new Error(`pages: "${key}": workspaces is ${PAGE_WORKSPACES.map((w) => `'${w}'`).join(' or ')}`);
    // listed in the sidebar unless it says sidebar: false, in the workspaces it names; its icon for the chrome's rail; primary: the
    // chrome puts it before every other entry
    const page = { title: def.title, src: `/_atelier/pages/${name}.js`, ...(def.icon ? { icon: def.icon } : {}), ...(def.sidebar === false ? { sidebar: false } : {}),
      ...(def.primary === true ? { primary: true } : {}),
      ...(def.workspaces ? { workspaces: def.workspaces } : {}) };
    if (key === 'signIn') out.signIn = page;
    else out.paths.set(key.length > 1 ? key.replace(/\/+$/, '') : key, page);
  }
  return out;
}

/**
 * The host's file `file` (a path resolved against `root`), loaded: the host, or a throw that says why it could not
 * load. `shell` is what the host's pages are served with: { mode, label, serveIndex, serveAsset, getModules,
 * getMetaByQId, resolveDefaultChromeQid, buildImportMap }.
 */
export async function loadHost(file, root, shell) {
  const at = resolvePathEntry(String(file), root);
  let person = null, sidebar = null, pages = null, handed = null;
  try {
    const hooks = await import(pathToFileURL(at).href);
    if (typeof hooks.person === 'function') person = hooks.person;
    if (typeof hooks.sidebar === 'function') sidebar = hooks.sidebar;
    if (typeof hooks.handed === 'function') handed = hooks.handed;
    if (hooks.pages && typeof hooks.pages === 'object') pages = loadHostPages(hooks.pages, path.dirname(at));
  } catch (err) {
    throw new Error(`could not load ${at}: ${err.message}`);
  }
  console.log(`  hosted by ${at}: the caller from ${CALLER_HEADER}${person ? ', the person from person()' : ''}${sidebar ? ', the sidebar from sidebar()' : ''}${handed ? ', an answer up front from handed()' : ''}${pages ? `, its pages ${[...pages.paths.keys()].join(' ')}${pages.signIn ? ' and its sign-in' : ''}` : ''}`);
  return createHost({ person, sidebar, pages, handed }, shell);
}

function createHost({ person, sidebar, pages, handed }, shell) {
  const signsIn = Boolean(person && pages?.signIn);

  // The host's sidebar list → the `user.workspaces` shape the chrome already draws. Each entry: { id, name?, icon?,
  // group?, origin?, workspace? }, or { workspace, name? } declaring a workspace; `origin` is where the module's frame
  // lives (under the host, not on this machine), at that origin's global address.
  /** A page's file by the name its served address carries, .jsx first; null when none. */
  const pageFile = (name) => ['.jsx', '.js'].map((e) => path.join(pages.dir, name + e)).find((f) => fs.existsSync(f)) || null;
  /** A page as the document names it up front: its served address and its file. */
  const pageEntry = (src) => ({ url: src, file: pageFile(PAGE_FILE.exec(src)[1]) });

  async function sidebarWorkspaces(req, who) {
    let list = [];
    try { list = await sidebar(req, who); }
    catch (err) { console.error(`  ! hosted sidebar() threw: ${err.message}`); }
    const byWs = new Map([[GLOBAL_WORKSPACE, []]]), names = new Map();
    for (const e of Array.isArray(list) ? list : []) {
      if (!e) continue;
      const named = typeof e.workspace === 'string' && MODULE_ID.test(e.workspace) ? e.workspace : null;
      if (e.id === undefined && named) {
        if (!byWs.has(named)) byWs.set(named, []);
        if (typeof e.name === 'string') names.set(named, e.name);
        continue;
      }
      if (typeof e.id !== 'string' || !MODULE_ID.test(e.id)) continue;
      const ws = named || GLOBAL_WORKSPACE;
      const meta = {};
      for (const k of ['name', 'icon', 'group']) if (typeof e[k] === 'string') meta[k] = e[k];
      const entry = { id: e.id, meta };
      if (typeof e.origin === 'string') { try { const u = new URL(e.origin); if (/^https?:$/.test(u.protocol)) entry.origin = u.origin; } catch {} }
      if (!byWs.has(ws)) byWs.set(ws, []);
      byWs.get(ws).push(entry);
    }
    return [...byWs.entries()]
      .sort(([a], [b]) => (a === GLOBAL_WORKSPACE ? -1 : b === GLOBAL_WORKSPACE ? 1 : a.localeCompare(b)))
      .map(([id, modules]) => ({ id, ...(names.has(id) ? { name: names.get(id) } : {}), modules }));
  }

  // The host's sign-in page for nobody: the chrome's stylesheet and kit (for its AuthLayout), the page, and nothing
  // about any module. 401, so a client that is not a browser still reads "not signed in".
  async function serveSignedOut(res, template) {
    const chromeQid = shell.resolveDefaultChromeQid(await shell.getMetaByQId());
    const chromeMod = chromeQid ? shell.getModules().find((x) => x.qualifiedId === chromeQid) : null;
    const importMap = shell.buildImportMap(chromeQid);
    const bootstrap = { mode: shell.mode, label: shell.label, signedOut: true, signIn: pages.signIn, chromeQid, assetTag: shell.assetTag() };
    let html = template.replace('/*__ATELIER_BOOTSTRAP__*/', `window.__ATELIER__ = ${JSON.stringify(bootstrap).replace(/</g, '\\u003c')};`);
    html = html.replace('<!--__ATELIER_IMPORTMAP__-->', importMap ? `<script type="importmap">${JSON.stringify(importMap)}</script>` : '');
    html = html.replace('<!--__ATELIER_PRELOAD__-->', await shell.preloadTags(chromeQid, [pageEntry(pages.signIn.src)]));
    html = html.replace('<!--__ATELIER_CHROME_STYLES__-->', chromeMod && fs.existsSync(path.join(chromeMod.dir, 'styles.css'))
      ? `<link id="atelier-chrome-styles" rel="stylesheet" href="${shell.addressOf(`/modules/${chromeQid}/styles.css`)}">` : '');
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }

  return {
    person,
    sidebar,
    pages,

    /**
     * Who the person is and what they see. The host's person() replaces the auth slot (`authSlot(req, defaultUser)`):
     * nothing → not signed in. Its sidebar(), when there is one, replaces the modules discovered in the folder.
     */
    async gate(req, defaultUser, authSlot) {
      let user;
      if (person) {
        let p = null;
        try { p = await person(req); }
        catch (err) { console.error(`  ! hosted person() threw: ${err.message}`); return null; }
        if (!p || p.person == null || p.person === '') return null;
        req.__hostPerson = { person: String(p.person), name: p.name == null ? null : String(p.name) };
        user = { id: req.__hostPerson.person, name: req.__hostPerson.name, workspaces: defaultUser.workspaces };
        // the host's sign-out address, for the chrome's account menu; it is not the caller (ctx.caller stays who, nothing else)
        if (typeof p.logout === 'string' && p.logout.startsWith('/')) user.logout = p.logout;
      } else {
        user = await authSlot(req, defaultUser);
      }
      if (!user || !sidebar) return user;
      return { ...user, workspaces: await sidebarWorkspaces(req, req.__hostPerson || { person: user.id, name: user.name ?? null }) };
    },

    /**
     * What the host hands the page up front, for the document of a person: its handed(req, person), carried by the
     * bootstrap as `handed`; null when it throws (the page asks as it would), and when the host exports none.
     */
    async handed(req) {
      if (!handed) return null;
      try { return (await handed(req, req.__hostPerson || null)) ?? null; }
      catch (err) { console.error(`  ! hosted handed() threw: ${err.message}`); return null; }
    },

    /** ctx.caller under a host: its header (base64url JSON, set after it verified the caller), else person()'s answer. */
    callerFor(req) {
      const raw = req.headers[CALLER_HEADER];
      if (raw) return headerObject(raw);
      return req.__hostPerson || null;
    },

    /**
     * Nobody, where person() fills the person: the shell says so and nothing more, as signing in is the host's page.
     * A request for the page (`template`, the index page) gets the host's sign-in page when it has one. → null.
     */
    async notSignedIn(res, template) {
      if (template && signsIn) await serveSignedOut(res, template);
      else {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('not signed in');
      }
      return null;
    },

    /**
     * For the page's bootstrap: the global workspace's name (where an entry with an origin has its frame, and where a
     * bare page path goes) and the host's own pages, by path, shown in the chrome's content area, not in a frame.
     */
    bootstrap() {
      return { globalWorkspace: GLOBAL_WORKSPACE, ...(pages ? { pages: [...pages.paths].map(([p, x]) => ({ path: p, ...x })) } : {}) };
    },

    /** The folders the host's assets are built from, for the shell's asset tag: its pages'. */
    sources() { return pages ? [pages.dir] : []; },

    /**
     * The page an address names for this person, as the browser will resolve it (page-at.js), as the document names it
     * up front: its served address and its file; null for any other address.
     */
    pageFor(pathname, user) {
      if (!pages) return null;
      const found = pageAt(pathname, { pages: [...pages.paths].map(([p, x]) => ({ path: p, ...x })), globalWorkspace: GLOBAL_WORKSPACE, workspaces: user?.workspaces || [] });
      return found ? pageEntry(found.page.src) : null;
    },

    /**
     * The requests that are the host's before any session: its pages' code, the default chrome's stylesheet and kit
     * for its sign-in page (public, like the shell's own assets: the chrome is the look of the sign-in page, not a
     * tenant's module), and a page asked by nobody, which gets the sign-in page at that path rather than the gate's
     * bare 401. → true when answered.
     */
    async serve(req, res, url) {
      if (!pages) return false;
      const pg = PAGE_FILE.exec(url.pathname);
      if (pg) {
        const src = pageFile(pg[1]);
        if (!src) { res.writeHead(404); res.end('Not found'); return true; }
        await shell.serveAsset(req, res, url, { kind: 'jsx', src });
        return true;
      }
      if (pages.signIn) {
        const chromeQid = shell.resolveDefaultChromeQid(await shell.getMetaByQId());
        if (chromeQid && (url.pathname === `/modules/${chromeQid}/styles.css` || url.pathname === `/modules/${chromeQid}/kit.js`)) {
          await shell.serveAsset(req, res, url);
          return true;
        }
      }
      if (signsIn && req.method === 'GET' && !RESERVED_PREFIX.test(url.pathname) && PAGE_PATH.test(url.pathname)) {
        await shell.serveIndex(req, res);
        return true;
      }
      return false;
    },
  };
}
