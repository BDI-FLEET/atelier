/* atelier · the host's pages in the page (hosted.js is the shell's side): pages are the host's own, apps are frames.
 *
 * A page lives in a workspace: `/<ws>/<path>` is the host's page `<path>` in the workspace `<ws>` (Home, at '/', is
 * `/<ws>/`), in each of the person's workspaces its `workspaces` names (every one when it names none), listed in the
 * sidebar there unless it says `sidebar: false`.
 * A bare `/<path>` of a link made before is taken to the page in the global workspace; `/` lands as any address with no
 * workspace does.
 *
 * A page is the host's React component (its file's default export, JSX transformed per file like a module frontend,
 * React from this page, `@atelier/kit` from the chrome), rendered here, in the page, inside the chrome's content area.
 * Props: { user, path, workspace, navigate(path) }.
 */

const { useState, useEffect } = React;

const hostPageCache = new Map();   // src → Promise<component>
function loadHostPage(src) {
  if (!hostPageCache.has(src)) hostPageCache.set(src, import(src).then((m) => {
    if (typeof m.default !== 'function') throw new Error(`${src} has no default export`);
    return m.default;
  }));
  return hostPageCache.get(src);
}
const boot = () => window.__ATELIER__ || {};
const hostPages = () => boot().pages || [];
/** Whether a page lives in a workspace: the ones its `workspaces` names (the global workspace, or every other one), else every one. */
function livesIn(page, workspace) {
  if (!page.workspaces) return true;
  const global = workspace === boot().globalWorkspace;
  return page.workspaces === boot().globalWorkspace ? global : !global;
}
/** A page's qid in a workspace, the address the chrome links it to without its leading slash: `<ws>/<path>`, Home's `<ws>/`. */
export const pageQid = (workspace, path) => `${workspace}/${path.slice(1)}`;
/**
 * The host's pages as sidebar entries, Home first: each page that lives in `workspace` and the host did not mark
 * `sidebar: false`, in the host's order, as a rail item of that workspace, its qid pageQid's (the chrome links an item to
 * `/<qid>`), `meta.primary` for the page the host marks `primary` alone, so a chrome that puts primary items first and sorts
 * the rest by name puts that one page before everything, `page` its path. Never a module, never a frame.
 */
export function pageEntries(workspace) {
  return hostPages().filter((p) => p.sidebar !== false && livesIn(p, workspace)).map((p, i) => ({
    id: `page:${p.path}`, qid: pageQid(workspace, p.path), workspace, hasFrontend: true, origin: null, page: p.path,
    meta: { name: p.title, icon: p.icon || 'file', primary: p.primary === true, order: i },
  }));
}
/** Every workspace's page entries, workspace by workspace: what the chrome is handed among `modules` (⌘K finds a page of another workspace). */
export const pageEntriesOf = (workspaces) => workspaces.flatMap((w) => pageEntries(w.id));
/** The workspaces as the chrome is handed them: each with its page entries before its modules, so a workspace with pages and no module is in the picker. */
export const withPages = (workspaces) => workspaces.map((w) => ({ ...w, modules: [...pageEntries(w.id), ...(w.modules || [])] }));
/**
 * The page an address names and the workspace it is in, from the bootstrap: `/<ws>/<path>` ('/x/' is '/x'; `/<ws>/` is
 * the page at '/'), `ws` one of the person's workspaces and the page living there → { page, workspace }; null for
 * anything else, and for an address a module of that workspace holds (the first segment of the path its id).
 */
export function hostPageFor(pathname) {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  let workspace;
  try { workspace = decodeURIComponent(m[1]); } catch { return null; }
  const ws = (boot().user?.workspaces || []).find((w) => w.id === workspace);
  if (!ws) return null;
  const path = (m[2] || '').replace(/\/+$/, '') || '/';
  if ((ws.modules || []).some((x) => x.id === path.split('/')[1])) return null;
  const page = hostPages().find((p) => p.path === path && livesIn(p, workspace));
  return page ? { page, workspace } : null;
}
/** A bare page path, as links made before pages lived in a workspace write it ('/companies'): its address in the global workspace; null for '/' and anything else. */
export function barePageAddress(pathname) {
  const path = pathname.replace(/\/+$/, '');
  return path && hostPages().some((p) => p.path === path) ? `/${encodeURIComponent(boot().globalWorkspace)}${path}` : null;
}
export function HostPage({ page, props }) {
  const [state, setState] = useState({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ kind: 'loading' });
    loadHostPage(page.src).then((C) => { if (live) setState({ kind: 'ok', C }); }, (err) => { if (live) setState({ kind: 'error', err }); });
    return () => { live = false; };
  }, [page.src]);
  if (state.kind === 'loading') return null;
  if (state.kind === 'error') return React.createElement('pre', { style: { whiteSpace: 'pre-wrap' } }, `${page.path || 'page'} · failed to load\n${state.err?.message || state.err}`);
  return React.createElement(state.C, props);
}

/** Nobody signed in, hosted: the host's sign-in page in the chrome's AuthLayout (from its kit), at the asked path. */
export function SignedOut() {
  const page = window.__ATELIER__.signIn;
  const [Layout, setLayout] = useState(null);
  useEffect(() => {
    document.title = `${page.title} — Atelier`;
    import('@atelier/kit').then((k) => setLayout(() => (typeof k.AuthLayout === 'function' ? k.AuthLayout : 'main')), () => setLayout(() => 'main'));
  }, []);
  if (!Layout) return null;
  // signed in: the asked page again, now with a person
  return React.createElement(Layout, null, React.createElement(HostPage, { page, props: { user: null, path: window.location.pathname, navigate: (to) => window.location.assign(to), signedIn: () => window.location.reload() } }));
}
