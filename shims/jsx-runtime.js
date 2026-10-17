// JSX automatic-runtime shim — same React instance as the shell.
// esbuild's `jsx: 'automatic'` rewrites `<div />` into calls into
// `react/jsx-runtime`'s `jsx`/`jsxs`/`Fragment`. We alias that to this
// file so the JSX nodes go through window.React.createElement, which is
// the same renderer the shell uses.
const R = (typeof window !== 'undefined' && window.React) || globalThis.React;
if (!R) throw new Error('atelier/shims/jsx-runtime.js: window.React not loaded yet');

export const Fragment = R.Fragment;

// Children travel as createElement ARGUMENTS, the way React's own runtime
// hands them over — that is what React's key check keys off:
//   jsxs → static children (`<a><b/><c/></a>`): spread as separate arguments,
//          which React marks validated — they never need keys, now or when a
//          library later re-passes them as an array (Headless UI does).
//   jsx  → one child, possibly a dynamic array (`{list.map(…)}`): passed as a
//          single argument, so an unkeyed list warns like it should.
// Passing children inside `props` instead skipped the check entirely: real
// missing keys stayed silent, and static children raised false warnings once
// re-passed as an array.
function create(type, props, key, isStatic) {
  const { children, ...rest } = props || {};
  if (key !== undefined) rest.key = key;
  if (!props || !('children' in props)) return R.createElement(type, rest);
  if (isStatic && Array.isArray(children)) return R.createElement(type, rest, ...children);
  return R.createElement(type, rest, children);
}

export const jsx = (type, props, key) => create(type, props, key, false);
export const jsxs = (type, props, key) => create(type, props, key, true);
// jsxDEV(type, props, key, isStaticChildren, …) — the dev runtime's signature.
export const jsxDEV = (type, props, key, isStatic) => create(type, props, key, !!isStatic);
