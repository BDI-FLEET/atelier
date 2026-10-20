/* atelier · the real-time channel, one WebSocket per tab to this origin's /_atelier/ws, many topics: the page's
 * (client.jsx) and a frame's (frame.jsx). Frames are JSON `{ topic, ...event }`; a module calls
 *
 *   const unsub = window.__atelier.subscribe(topic, (event) => { … });
 *   const self = window.__atelier.self(import.meta.url);   // { workspace, id, qid, topic, api, subscribe }
 *
 * `self` derives the module's qualifiedId from where it is mounted, so the same module works in any workspace:
 * `self.subscribe` listens on '<ws>/<id>', `self.api` is '/api/<ws>/<id>'. The socket reconnects with exponential
 * backoff. With `watch` (the page), how the connection is reaches the window as `atelier:connection` events
 * ('online' | 'offline' | 'unauthed'), said after a grace, for the chrome's banner.
 */
const OFFLINE_GRACE_MS = 2500;

export function wireWsBridge({ watch = false } = {}) {
  if (window.__atelier?.subscribe) return;
  window.__atelier = window.__atelier || {};

  const subscribers = new Map();
  let ws = null;
  let backoff = 250;
  let reconnectTimer = null;

  let connState = 'online';
  let offlineTimer = null;
  function setConnState(next) {
    if (connState === next) return;
    connState = next;
    try {
      window.dispatchEvent(new CustomEvent('atelier:connection', { detail: { state: next } }));
    } catch {}
  }

  async function probeAuth() {
    const r = await fetch('/_atelier/whoami', { cache: 'no-store', credentials: 'same-origin' });
    return r.status;
  }

  function armOfflineTimer() {
    if (!watch || offlineTimer) return;
    offlineTimer = setTimeout(async () => {
      offlineTimer = null;
      if (ws && ws.readyState === 1) return;
      try {
        const status = await probeAuth();
        if (status === 200) return;
        if (status === 401) { setConnState('unauthed'); return; }
        setConnState('offline');
      } catch {
        setConnState('offline');
      }
    }, OFFLINE_GRACE_MS);
  }
  function clearOfflineTimer() {
    if (!offlineTimer) return;
    clearTimeout(offlineTimer);
    offlineTimer = null;
  }

  function dispatch(frame) {
    const fns = frame?.topic && subscribers.get(frame.topic);
    if (!fns) return;
    for (const fn of fns) {
      try { fn(frame); } catch (err) {
        console.warn('[atelier] subscribe handler threw:', err);
      }
    }
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${proto}//${window.location.host}/_atelier/ws`);
    } catch {
      armOfflineTimer();
      scheduleReconnect();
      return;
    }
    ws.onmessage = (m) => {
      let frame;
      try { frame = JSON.parse(m.data); } catch { return; }
      dispatch(frame);
    };
    ws.onopen = () => {
      backoff = 250;
      clearOfflineTimer();
      if (watch) setConnState('online');
    };
    ws.onclose = () => {
      ws = null;
      armOfflineTimer();
      scheduleReconnect();
    };
    ws.onerror = () => { /* close fires next */ };
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  }

  window.__atelier.subscribe = (topic, handler) => {
    if (!topic || typeof handler !== 'function') return () => {};
    let set = subscribers.get(topic);
    if (!set) { set = new Set(); subscribers.set(topic, set); }
    set.add(handler);
    if (!ws) connect();
    return () => {
      const s = subscribers.get(topic);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) subscribers.delete(topic);
    };
  };

  window.__atelier.self = (metaUrl) => {
    let qid = '';
    try { qid = new URL('.', metaUrl).pathname.replace(/^\/modules\//, '').replace(/\/+$/, ''); } catch {}
    const [workspace = '', id = ''] = qid.split('/');
    return {
      workspace,
      id,
      qid,
      topic: qid,
      api: qid ? '/api/' + qid : '',
      subscribe: (handler) => window.__atelier.subscribe(qid, handler),
    };
  };

  connect();
}
