// host-pages.jsx as the browser gets it (its JSX transformed by getJsx, as the shell transforms its own files), run against a page's bootstrap:
// which workspaces list each host page, and which page and workspace an address names.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getJsx } from '../build.js'
import { ROOT } from './ours.js'

globalThis.React = { useState: () => [null, () => {}], useEffect: () => {}, createElement: () => null }
globalThis.window = { __ATELIER__: {} }
const pages = await import(`data:text/javascript,${encodeURIComponent((await getJsx(path.join(ROOT, 'host-pages.jsx'))).content)}`)

const PAGES = [
  { path: '/', title: 'Home', src: '/_atelier/pages/home.js', icon: 'house' },
  { path: '/companies', title: 'Companies', src: '/_atelier/pages/companies.js' },
  { path: '/agents', title: 'Agents', src: '/_atelier/pages/agents.js', workspaces: 'global' },
  { path: '/plans', title: 'Plans', src: '/_atelier/pages/plans.js', workspaces: 'others' },
  { path: '/activate', title: 'Activate', src: '/_atelier/pages/activate.js', sidebar: false },
]
const WORKSPACES = [{ id: 'global', modules: [{ id: 'notes', meta: {} }] }, { id: 'halden', name: 'Halden', modules: [] }]
window.__ATELIER__ = { globalWorkspace: 'global', pages: PAGES, user: { id: 'ana', workspaces: WORKSPACES } }

test("a page is listed in the workspaces it names, the global one or the others, in every one when it names none, and nowhere with sidebar: false", () => {
  const listed = (ws) => pages.pageEntries(ws).map((e) => e.meta.name)
  assert.deepEqual(listed('global'), ['Home', 'Companies', 'Agents'])
  assert.deepEqual(listed('halden'), ['Home', 'Companies', 'Plans'])
})
