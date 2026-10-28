/* atelier frame — the module's side of a frame, served on the module's own origin at /_frame/frame.js.
 *
 * A module is shown in a frame on its own origin: it cannot read the page, the sidebar or another frame. This file is
 * what runs in that frame around the module, and the module sees the same contract it had in the page:
 *   window.__atelier.self(import.meta.url)   → { workspace, id, qid, topic, api, subscribe }
 *   window.__atelier.subscribe(topic, fn)    → the real-time channel, on this origin, carrying this module's topic only
 *   window.__atelier.useRoute()              → { path, navigate }, the module's own sub-route
 *
 * The bridge to the page, by postMessage with the exact origin both ways:
 *   the frame gets:  init { route, href, title, theme } · route { route, href } · theme { theme } · dim { on }
 *                    and ⌘K and Esc: pressed in here, they are handed to the page as if pressed there (key { … })
 *   the frame gives: route { route, replace } · title { title }
 * Nothing else crosses. The page owns the history: in here the URL is only ever replaced, never pushed.
 * ========================================================================= */

import { wireWsBridge } from './ws-bridge.js';

const F = window.__ATELIER_FRAME__ || {};
const PARENT = F.parent && window.parent !== window ? F.parent : null;   // null: opened on its own, no bridge
const BASE = `/${encodeURIComponent(F.workspace)}/${encodeURIComponent(F.id)}`;
const toParent = (type, data) => { if (PARENT) window.parent.postMessage({ atelier: type, ...data }, PARENT); };

window.__atelier = window.__atelier || {};

/* ---- the real-time channel, on this origin (ws-bridge.js) ---- */
wireWsBridge();

/* ---- the module's route ---- */
function currentRoute() {
  const p = window.location.pathname;
  if (!p.startsWith(BASE)) return '';
  try { return decodeURIComponent(p.slice(BASE.length).replace(/^\/+|\/+$/g, '')); } catch { return ''; }
}
const urlFor = (route) => (route ? `${BASE}/${String(route).replace(/^\/+|\/+$/g, '')}` : BASE);
let deepLink = window.location.href;
function setRoute(route) {
  const target = urlFor(route);
  if (target !== window.location.pathname) window.history.replaceState(null, '', target + window.location.search + window.location.hash);
  window.dispatchEvent(new CustomEvent('atelier:route'));
}
window.__atelier.navigate = (sub, opts) => {
  setRoute(sub || '');
  toParent('route', { route: currentRoute(), replace: !!(opts && opts.replace) });
};
window.__atelier.useRoute = () => {
  const R = window.React;
  const [, bump] = R.useState(0);
  R.useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('atelier:route', on);
    return () => window.removeEventListener('atelier:route', on);
  }, []);
  return { path: currentRoute(), navigate: window.__atelier.navigate };
};
// The page's address for this module at its current route, to copy or share.
window.__atelier.deepLink = () => deepLink;

// The address the page opened the frame with carries `atelier-parent`; the module never sees it.
(() => {
  const u = new URL(window.location.href);
  if (u.searchParams.has('atelier-parent')) {
    u.searchParams.delete('atelier-parent');
    window.history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
})();

/* ---- the bridge ---- */
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
if (PARENT) {
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== PARENT) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || typeof d.atelier !== 'string') return;
    if (d.atelier === 'init' || d.atelier === 'route') {
      if (typeof d.href === 'string') deepLink = d.href;
      if (typeof d.route === 'string' && d.route !== currentRoute()) setRoute(d.route);
    }
    if ((d.atelier === 'init' || d.atelier === 'theme') && typeof d.theme === 'string') applyTheme(d.theme);
    if (d.atelier === 'init' && typeof d.title === 'string' && document.title === F.title) document.title = d.title;
    if (d.atelier === 'dim') {
      document.documentElement.toggleAttribute('data-atelier-dim', !!d.on);
      document.getElementById('root')?.toggleAttribute('inert', !!d.on);
    }
  });
  // ⌘K and Esc belong to the page (the palette, a dialog). Pressed in here, they are handed over.
  document.addEventListener('keydown', (e) => {
    const k = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K');
    if (!k && e.key !== 'Escape') return;
    if (k) e.preventDefault();
    toParent('key', { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
  }, true);
  // The title the module gives itself (document.title) goes up as the frame's title.
  let lastTitle = null;
  const sendTitle = () => { if (document.title !== lastTitle) { lastTitle = document.title; toParent('title', { title: document.title }); } };
  new MutationObserver(sendTitle).observe(document.head, { subtree: true, childList: true, characterData: true });
  toParent('ready', {});
  sendTitle();
}

/* ---- the module ---- */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error(`[atelier] module '${F.qid}' render crashed:`, err, info?.componentStack || ''); }
  componentDidUpdate(prev) { if (this.state.err && prev.moduleType !== this.props.moduleType) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    const e = this.state.err;
    return React.createElement('pre', { style: { margin: 0, padding: 24, whiteSpace: 'pre-wrap', font: '13px/1.6 ui-monospace, Menlo, monospace' } },
      `${F.qid} · render error\n\n${(e && (e.stack || e.message)) || String(e)}`);
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
async function load(v) {
  try {
    // a hot-swapped version by its number; otherwise by the asset tag when the instance keeps its files (hot reload off)
    const mod = await import(`/modules/${F.qid}/frontend.js${v ? `?v=${v}` : F.assetTag ? `?v=${F.assetTag}` : ''}`);
    const M = typeof mod.default === 'function' ? mod.default : null;
    if (!M) throw new Error('no default export');
    root.render(React.createElement(Boundary, { moduleType: M }, React.createElement(M)));
  } catch (err) {
    root.render(React.createElement('pre', { style: { margin: 0, padding: 24, whiteSpace: 'pre-wrap', font: '13px/1.6 ui-monospace, Menlo, monospace' } },
      `${F.qid} · failed to load\n\n${(err && (err.stack || err.message)) || String(err)}`));
  }
}
load(0);

// A save re-imports this module in place; a new stylesheet is fetched for classes the edit introduced.
let bust = 0;
window.__atelier.subscribe('shell', (frame) => {
  if (frame.type !== 'reload' || frame.moduleId !== F.qid) return;
  load(++bust);
  const cur = document.getElementById('atelier-frame-styles');
  if (cur) {
    const next = cur.cloneNode(false);
    next.setAttribute('href', `/_frame/styles.css?v=${bust}`);
    const drop = () => { try { cur.remove(); } catch {} };
    next.addEventListener('load', drop);
    next.addEventListener('error', drop);
    cur.removeAttribute('id');
    cur.parentNode.insertBefore(next, cur.nextSibling);
  }
});
