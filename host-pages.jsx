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

import { pageAt, livesIn as lives } from './page-at.js';
import { pageLoader, pageDrawn } from './page-drawn.js';

const { useState, useEffect, useRef } = React;

const hostPageCode = pageLoader((src) => import(addressOf(src)).then((m) => {
  if (typeof m.default !== 'function') throw new Error(`${src} has no default export`);
  return m.default;
}));
/** A host page's code, imported once: resolves when it has loaded or was refused; from then on the page draws in the render that asks for it. */
export const loadHostPage = (src) => hostPageCode.load(src);
const boot = () => window.__ATELIER__ || {};
/** An asset's address as the page imports it: with the shell's asset tag when the bootstrap carries one (hot reload off: the asset keeps). */
export const addressOf = (p) => (boot().assetTag ? `${p}?v=${boot().assetTag}` : p);
const hostPages = () => boot().pages || [];
const livesIn = (page, workspace) => lives(page, workspace, boot().globalWorkspace);
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
export const hostPageFor = (pathname) => pageAt(pathname, { pages: hostPages(), globalWorkspace: boot().globalWorkspace, workspaces: boot().user?.workspaces || [] });
/** A bare page path, as links made before pages lived in a workspace write it ('/companies'): its address in the global workspace; null for '/' and anything else. */
export function barePageAddress(pathname) {
  const path = pathname.replace(/\/+$/, '');
  return path && hostPages().some((p) => p.path === path) ? `/${encodeURIComponent(boot().globalWorkspace)}${path}` : null;
}
/**
 * The host's page `page` drawn with `props`, as one page in the content area for as long as the shell shows host pages:
 * keyed by `qid`, so each page in each workspace is its own; while a page's code is on its way, the page drawn before stays.
 */
export function HostPage({ page, qid, props }) {
  const [, settledNow] = useState(0);
  const before = useRef(null);
  const settled = hostPageCode.settled(page.src);
  useEffect(() => {
    if (settled) return;
    let live = true;
    loadHostPage(page.src).then(() => { if (live) settledNow((n) => n + 1); });
    return () => { live = false; };
  }, [page.src]);
  const drawn = pageDrawn({ path: page.path, key: qid, props }, settled, before.current);
  useEffect(() => { before.current = drawn; });
  if (!drawn) return null;
  if (drawn.C) return React.createElement(drawn.C, { key: drawn.key, ...drawn.props });
  return React.createElement('pre', { key: drawn.key, style: { whiteSpace: 'pre-wrap' } }, `${drawn.path || 'page'} · failed to load\n${drawn.failed?.message || drawn.failed}`);
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
