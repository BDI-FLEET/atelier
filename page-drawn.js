/* atelier · what a host page draws (host-pages.jsx is its React side): a click in place never shows an empty page. A page
 * whose code is loaded draws in the same render; a page whose code is not loaded yet leaves what was drawn before on
 * screen until it is.
 */

/**
 * The host's pages' code, each page's imported once by `importPage` (src → Promise<component>): `settled(src)` is
 * { C } once its import resolved, { err } once it was refused, null before; `load(src)` resolves when it has settled.
 */
export function pageLoader(importPage) {
  const loads = new Map(), settled = new Map();
  return {
    settled: (src) => settled.get(src) || null,
    load(src) {
      if (!loads.has(src)) loads.set(src, importPage(src).then((C) => { settled.set(src, { C }); }, (err) => { settled.set(src, { err }); }));
      return loads.get(src);
    },
  };
}

/**
 * What a host page draws for the page `asked` ({ path, key, props }) whose code is `settled`: the page with its props once
 * its code is loaded, its failure once its import was refused, else what it drew `before` (null when it drew nothing).
 * → { key, C, props } | { key, path, failed } | before
 */
export function pageDrawn(asked, settled, before) {
  if (!settled) return before;
  return settled.C ? { key: asked.key, C: settled.C, props: asked.props } : { key: asked.key, path: asked.path, failed: settled.err };
}
