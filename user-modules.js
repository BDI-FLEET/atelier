/* atelier · the person's modules as the page holds them: each one of a workspace's modules with its qid there and where
 * its frame is (client.jsx lists them, the chrome draws them, module-frame.jsx frames the active one).
 */

export function flattenUserModules(user) {
  if (!user) return [];
  const out = [];
  for (const ws of user.workspaces || []) {
    for (const m of ws.modules || []) {
      out.push({
        id: m.id,
        qid: `${ws.id}/${m.id}`,
        workspace: ws.id,
        hasFrontend: m.hasFrontend !== false,
        meta: m.meta || {},
        // Where its frame lives: the origin a host's entry names, the app alone in the global workspace there,
        // whatever workspace lists it here; else this instance's own origin for the module, at its own qid.
        origin: m.origin || (window.__ATELIER__?.frames || {})[`${ws.id}/${m.id}`] || null,
        frameQid: `${m.origin ? window.__ATELIER__.globalWorkspace : ws.id}/${m.id}`,
      });
    }
  }
  return out;
}
