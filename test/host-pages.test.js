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

test("an address /<workspace>/<path> is the page at that path in that workspace of the person's where it lives, Home at /<workspace>/, a module of that name first", () => {
  const at = (address) => { const f = pages.hostPageFor(address); return f && [f.workspace, f.page.title] }
  assert.deepEqual(at('/halden/companies'), ['halden', 'Companies'])
  assert.deepEqual(at('/halden/companies/'), ['halden', 'Companies'])
  assert.deepEqual([at('/halden/'), at('/halden'), at('/global/')], [['halden', 'Home'], ['halden', 'Home'], ['global', 'Home']])
  assert.deepEqual([at('/halden/plans'), at('/global/agents')], [['halden', 'Plans'], ['global', 'Agents']])
  // a page listed nowhere lives in every workspace; a page lives nowhere it is not listed; a workspace not hers holds nothing
  assert.deepEqual([at('/global/activate'), at('/halden/activate')], [['global', 'Activate'], ['halden', 'Activate']])
  assert.deepEqual([at('/global/plans'), at('/halden/agents'), at('/acme/companies'), at('/companies'), at('/global/nothing')], [null, null, null, null, null])
  // the workspace's module of that id is the module
  window.__ATELIER__.pages = [...PAGES, { path: '/notes', title: 'Notes page', src: '/_atelier/pages/notes.js' }]
  try { assert.deepEqual([at('/global/notes'), at('/halden/notes')], [null, ['halden', 'Notes page']]) } finally { window.__ATELIER__.pages = PAGES }
})

test("a bare page path of an old link is that page in the global workspace, and nothing else is: not /, not a workspace's address, not a path no page has", () => {
  assert.deepEqual(['/companies', '/companies/', '/activate', '/', '/global/companies', '/halden/', '/nothing'].map(pages.barePageAddress),
    ['/global/companies', '/global/companies', '/global/activate', null, null, null, null])
})

test("a page's entry in a workspace is its rail item there: its qid the workspace and the path, Home's the workspace and a slash, as the chrome links /<qid>", () => {
  assert.deepEqual(pages.pageEntries('halden').map((e) => [e.qid, e.workspace, e.page]), [['halden/', 'halden', '/'], ['halden/companies', 'halden', '/companies'], ['halden/plans', 'halden', '/plans']])
  assert.equal(pages.pageQid('global', '/'), 'global/')
})

test("a page listed nowhere lives in the workspaces its workspaces names, in every one when it names none", () => {
  window.__ATELIER__.pages = [...PAGES, { path: '/plan', title: 'Plan', src: '/_atelier/pages/plan.js', sidebar: false, workspaces: 'others' }]
  try {
    assert.deepEqual([pages.hostPageFor('/halden/plan')?.page.title, pages.hostPageFor('/global/plan'), pages.hostPageFor('/global/activate')?.page.title], ['Plan', null, 'Activate'])
    assert.deepEqual(pages.pageEntries('halden').map((e) => e.page), ['/', '/companies', '/plans'])
  } finally { window.__ATELIER__.pages = PAGES }
})

test("the chrome is handed every workspace with its pages among its modules, so one with pages and no module is in the picker, and every workspace's pages for ⌘K", () => {
  const shown = pages.withPages(WORKSPACES)
  assert.deepEqual(shown.map((w) => [w.id, w.name, w.modules.map((m) => m.qid ?? m.id)]),
    [['global', undefined, ['global/', 'global/companies', 'global/agents', 'notes']], ['halden', 'Halden', ['halden/', 'halden/companies', 'halden/plans']]])
  assert.deepEqual(WORKSPACES[1].modules, [], "the person's workspaces stay as the server gave them")
  assert.deepEqual(pages.pageEntriesOf(WORKSPACES).map((e) => e.qid), ['global/', 'global/companies', 'global/agents', 'halden/', 'halden/companies', 'halden/plans'])
})
