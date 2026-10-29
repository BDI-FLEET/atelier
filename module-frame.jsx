/* atelier · the page's side of a module's frame: every module on its own origin (frame.jsx is the frame's side).
 *
 * The module runs in an <iframe> on its own origin (window.__ATELIER__.frames, or a host's sidebar entry), so it
 * cannot read this page, the sidebar or another frame. The bridge is postMessage with the exact origin both ways:
 *   to the frame:   init { route, href, title, theme } · route { route, href } · theme { theme } · dim { on }
 *   from the frame: ready · route { route, replace } · title { title } · key { ⌘K, ⌘B or Esc, pressed in the frame }
 * This page owns the history: a route from the frame becomes a pushState here; back/forward goes down as a route.
 * The chrome renders the frame where it rendered the module; nothing in the chrome changes. `buildUrl(ws, id, route)`
 * is the page's address for a module's route (client.jsx).
 */

const { useState, useEffect, useRef } = React;

/* The longest title a frame may give its page. */
const FRAME_TITLE_CHARS = 200;
/* The lowest a frame is drawn, however little room the window leaves it. */
const FRAME_MIN_HEIGHT = 240;

const themeNow = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function ModuleFrame({ qid, frameQid, origin, route, title, onTitle, buildUrl }) {
  const ref = useRef(null);
  const [box, setBox] = useState(null);
  const [theme, setTheme] = useState(themeNow);
  const [ws, id] = qid.split('/');
  // The first address only, the frame's own on its origin; later routes travel by the bridge (a new src would reload the module).
  const src = React.useMemo(() => {
    const [frameWs, frameId] = frameQid.split('/');
    const u = new URL(buildUrl(frameWs, frameId, route), origin);
    u.searchParams.set('atelier-parent', window.location.origin);
    return u.href;
  }, [frameQid, origin]);
  const routeRef = useRef(route);
  routeRef.current = route;
  const post = (type, data) => {
    const w = ref.current?.contentWindow;
    if (w) w.postMessage({ atelier: type, ...data }, origin);
  };

  // Messages from the frame: only from this frame's window, only from its origin.
  useEffect(() => {
    const onMsg = (e) => {
      if (!ref.current || e.source !== ref.current.contentWindow || e.origin !== origin) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || typeof d.atelier !== 'string') return;
      if (d.atelier === 'ready') {
        post('init', { route: routeRef.current, href: window.location.href, title, theme: themeNow() });
      } else if (d.atelier === 'route' && typeof d.route === 'string') {
        const target = buildUrl(ws, id, d.route);
        if (target !== window.location.pathname) {
          window.history[d.replace ? 'replaceState' : 'pushState'](null, '', target);
          window.dispatchEvent(new CustomEvent('atelier:route'));
        }
      } else if (d.atelier === 'title' && typeof d.title === 'string') {
        onTitle?.(d.title.slice(0, FRAME_TITLE_CHARS));
      } else if (d.atelier === 'key' && (d.key === 'Escape' || d.key === 'k' || d.key === 'K' || d.key === 'b' || d.key === 'B')) {
        // Handed to this page as if pressed here: the chrome's ⌘K palette and ⌘B sidebar, a dialog's Esc.
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: d.key, metaKey: !!d.metaKey, ctrlKey: !!d.ctrlKey, shiftKey: !!d.shiftKey, altKey: !!d.altKey,
          bubbles: true, cancelable: true,
        }));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [qid, origin, title]);

  // Back/forward or a deep link changed the route here → down to the frame.
  useEffect(() => { post('route', { route, href: window.location.href }); }, [route]);

  // The theme follows the page's: the chrome marks it on <html>.
  useEffect(() => {
    let last = themeNow();
    const mo = new MutationObserver(() => { const t = themeNow(); if (t !== last) { last = t; setTheme(t); post('theme', { theme: t }); } });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [origin]);

  // Dim for a modal: a dialog of the page makes the rest inert (or aria-hidden); the frame is told.
  useEffect(() => {
    let last = false;
    const check = () => {
      const on = !!ref.current?.closest('[inert],[aria-hidden="true"]');
      if (on !== last) { last = on; post('dim', { on }); }
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] });
    return () => mo.disconnect();
  }, [origin]);

  // The frame is the whole canvas: it spans the chrome's padded panel edge to edge (the panel's padding undone by its
  // margins, the panel's rounded corners clipping it) and reaches the bottom of the window; the module scrolls inside it.
  React.useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      let panel = el.parentElement, pad = { top: 0, right: 0, bottom: 0, left: 0 };
      for (; panel && panel !== document.body; panel = panel.parentElement) {
        const cs = getComputedStyle(panel);
        pad = { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) };
        if (pad.top || pad.right || pad.bottom || pad.left) break;
      }
      const inPanel = panel && panel !== document.body;
      let below = inPanel ? parseFloat(getComputedStyle(panel).borderBottomWidth) : 0;
      for (let n = inPanel ? panel.parentElement : el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        below += parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
      }
      // where the frame's top edge lands once its margins span the panel: the panel's inner top edge
      const top = (inPanel ? panel.getBoundingClientRect().top + parseFloat(getComputedStyle(panel).borderTopWidth) : el.getBoundingClientRect().top) + window.scrollY;
      setBox({ pad, height: Math.max(FRAME_MIN_HEIGHT, Math.floor(window.innerHeight - top - below)) });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => { window.removeEventListener('resize', measure); ro.disconnect(); };
  }, [qid]);

  return React.createElement('iframe', {
    ref,
    src,
    title: title || qid,
    'data-atelier-frame': qid,
    style: { display: 'block', border: 0, background: 'transparent', colorScheme: theme,   // the frame's scheme, so its page stays see-through
      ...(box ? { height: `${box.height}px`, width: `calc(100% + ${box.pad.left + box.pad.right}px)`, margin: `-${box.pad.top}px -${box.pad.right}px -${box.pad.bottom}px -${box.pad.left}px` } : { width: '100%', height: '70vh' }) },
  });
}
