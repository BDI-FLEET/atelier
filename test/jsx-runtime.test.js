// The jsx-runtime shim (bundled chromes compile JSX through it): children must
// reach React.createElement as ARGUMENTS, the way React's own runtime passes
// them — static children marked validated (no false "missing key" warnings when
// a library like Headless UI re-passes them as an array), dynamic arrays still
// key-checked (real missing keys warn).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let React, shim, warnings, origError

before(async () => {
  process.env.NODE_ENV = 'development'
  React = require('react')
  globalThis.React = React
  shim = await import('../shims/jsx-runtime.js')
  origError = console.error
  console.error = (...a) => { warnings.push(a.map(String).join(' ')) }
})
after(() => { console.error = origError; delete globalThis.React })

const keyWarnings = () => warnings.filter((w) => /unique "key" prop/.test(w))

test('jsxs: static children need no keys — even when re-passed as an array', () => {
  warnings = []
  const el = shim.jsxs('div', { children: [shim.jsx('b', {}), shim.jsx('i', {})] })
  // what Headless UI's render does with a component's children
  React.createElement('span', null, el.props.children)
  assert.deepEqual(keyWarnings(), [])
})

test('jsx: a dynamic array of unkeyed elements still warns', () => {
  warnings = []
  shim.jsx('ul', { children: [1, 2].map((n) => shim.jsx('li', { children: n })) })
  assert.equal(keyWarnings().length, 1)
})

test('key, ref-free props and children all arrive intact', () => {
  warnings = []
  const el = shim.jsxs('div', { id: 'x', children: ['a', shim.jsx('b', {}, 'k1')] }, 'root')
  assert.equal(el.key, 'root')
  assert.equal(el.props.id, 'x')
  assert.equal(el.props.children.length, 2)
  assert.equal(el.props.children[1].key, 'k1')
  assert.equal(shim.jsx('br', {}).props.children, undefined)
})
