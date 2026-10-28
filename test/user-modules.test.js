// user-modules.js and module-frame.jsx as the browser gets them (transformed by getJsx, as the shell transforms its own
// files), run against a page's bootstrap: where each module the page lists has its frame, and the address the frame opens at.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { getJsx } from '../build.js'
import { ROOT } from './ours.js'

globalThis.React = {
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (current) => ({ current }),
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  createElement: (type, props) => ({ type, props }),
}
globalThis.document = { documentElement: { classList: { contains: () => false } } }
globalThis.window = { __ATELIER__: {}, location: { origin: 'https://atelier.example' } }
const served = async (file) => import(`data:text/javascript,${encodeURIComponent((await getJsx(path.join(ROOT, file))).content)}`)
const { flattenUserModules } = await served('user-modules.js')
const { ModuleFrame } = await served('module-frame.jsx')

const buildUrl = (ws, id, rest) => `/${ws}/${id}${rest ? `/${rest}` : ''}`
window.__ATELIER__ = {
  globalWorkspace: 'global',
  frames: { 'team/board': 'http://board.team.localhost:4321' },
  user: { id: 'ana', workspaces: [
    { id: 'halden', modules: [{ id: 'notes', meta: {}, origin: 'https://m-notes.apps.example' }] },
    { id: 'team', modules: [{ id: 'board', meta: {}, hasSidebar: true }] },
  ] },
}
const [notes, board] = flattenUserModules(window.__ATELIER__.user)

test("a host's entry with an origin, listed in a company's workspace, has its qid there and its frame at the origin's global address, and an instance's own module its frame at its own qid", () => {
  assert.deepEqual([notes.qid, notes.origin, notes.frameQid], ['halden/notes', 'https://m-notes.apps.example', 'global/notes'])
  assert.deepEqual([board.qid, board.origin, board.frameQid], ['team/board', 'http://board.team.localhost:4321', 'team/board'])
})

test("a module's entry says whether its frontend exports a Sidebar, as the server read it from the source, and nothing else is loaded for it", () => {
  assert.deepEqual([notes.hasSidebar, board.hasSidebar], [false, true])
})

test("a module's frame opens at its frame's own address on its origin with the page's route, whatever workspace of the page lists it", () => {
  const src = (m, route) => ModuleFrame({ qid: m.qid, frameQid: m.frameQid, origin: m.origin, route, title: m.id, buildUrl }).props.src
  assert.equal(src(notes, 'n/1'), 'https://m-notes.apps.example/global/notes/n/1?atelier-parent=https%3A%2F%2Fatelier.example')
  assert.equal(src(board, ''), 'http://board.team.localhost:4321/team/board?atelier-parent=https%3A%2F%2Fatelier.example')
})
