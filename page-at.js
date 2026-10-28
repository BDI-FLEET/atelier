/* atelier · the host's page an address names: `/<ws>/<path>` is the page at `<path>` in the workspace `<ws>` (Home, at '/',
 * is `/<ws>/`), when `<ws>` is one of the person's workspaces, the page lives there, and no module of that workspace has
 * the path's first segment as its id. One rule for the browser (host-pages.jsx, from the page's bootstrap) and the shell
 * (hosted.js, from what it serves the document with), so what the document names up front is what the page will draw.
 */

/** Whether a page lives in a workspace: the ones its `workspaces` names (the global workspace, or every other one), else every one. */
export function livesIn(page, workspace, globalWorkspace) {
  if (!page.workspaces) return true;
  const global = workspace === globalWorkspace;
  return page.workspaces === globalWorkspace ? global : !global;
}

/** → { page, workspace } for the page `pathname` names among `pages` in the person's `workspaces`; null for anything else. */
export function pageAt(pathname, { pages, globalWorkspace, workspaces }) {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return null;
  let workspace;
  try { workspace = decodeURIComponent(m[1]); } catch { return null; }
  const ws = (workspaces || []).find((w) => w.id === workspace);
  if (!ws) return null;
  const path = (m[2] || '').replace(/\/+$/, '') || '/';
  if ((ws.modules || []).some((x) => x.id === path.split('/')[1])) return null;
  const page = (pages || []).find((p) => p.path === path && livesIn(p, workspace, globalWorkspace));
  return page ? { page, workspace } : null;
}
