/* atelier · the host's pages in the page (hosted.js is the shell's side): pages are the host's own, apps are frames.
 *
 * A page is the host's React component (its file's default export, JSX transformed per file like a module frontend,
 * React from this page, `@atelier/kit` from the chrome), rendered here, in the page, inside the chrome's content area.
 * Props: { user, path, navigate(path) }.
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
/** Whether a page is listed in a workspace: the one its `workspaces` names (the global workspace, or every other one), else every one. */
function listedIn(page, workspace) {
  if (!page.workspaces) return true;
  const global = workspace === boot().globalWorkspace;
  return page.workspaces === boot().globalWorkspace ? global : !global;
}
/**
 * The host's pages as sidebar entries, Home first: each page the host did not mark `sidebar: false` and that is listed
 * in `workspace`, in the host's order, as a rail item of that workspace, its qid its path without the leading slash (the chrome links an
 * item to `/<qid>`: Home's is ''), `meta.primary` so a chrome that puts primary items first puts them before the apps,
 * `page` its path. Never a module, never a frame: navigate() takes a page's qid to its path.
 */
export function pageEntries(workspace) {
  return hostPages().filter((p) => p.sidebar !== false && listedIn(p, workspace)).map((p, i) => ({
    id: `page:${p.path}`, qid: p.path.slice(1), workspace: workspace || '', hasFrontend: true, origin: null, page: p.path,
    meta: { name: p.title, icon: p.icon || 'file', primary: true, order: i },
  }));
}
/** The host page for a path, from the bootstrap: an exact match ('/x/' is '/x'). */
export function hostPageFor(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (window.__ATELIER__?.pages || []).find((x) => x.path === p) || null;
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
