// hosted.js on its own: the host's file as loadHost reads it, and what the host it returns answers server.js.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadHost } from '../hosted.js'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-hosted-'))
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(DIR, rel)), { recursive: true }); fs.writeFileSync(path.join(DIR, rel), text); return path.join(DIR, rel) }
after(() => fs.rmSync(DIR, { recursive: true, force: true }))
const quiet = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn() } finally { console.log = log } }

test("the host's sidebar() replaces the discovered modules: the entries it names, valid ids only, global first, an origin cut to its scheme, name and port", async () => {
  const file = put('sidebar.js', `export function sidebar(req, who) { return [
    { id: 'board', workspace: 'team', name: 'Board', origin: 'https://board.team.apps.example/x?y' },
    { id: 'notes', icon: 'pen', group: 7 }, { id: '../up' }, { id: 'mail', origin: 'ftp://mail.example' },
  ] }\n`)
  const host = await quiet(() => loadHost(file, DIR, {}))
  const user = await host.gate({ headers: {} }, { id: 'local', workspaces: [] }, async (req, d) => ({ ...d, name: 'Local' }))
  assert.deepEqual(user.workspaces, [
    { id: 'global', modules: [{ id: 'notes', meta: { icon: 'pen' } }, { id: 'mail', meta: {} }] },
    { id: 'team', modules: [{ id: 'board', meta: { name: 'Board' }, origin: 'https://board.team.apps.example' }] },
  ])
})

test("a sidebar entry that names a workspace and no id declares the workspace: listed with no modules, with its name when it gives one", async () => {
  const file = put('declared.js', `export function sidebar() { return [
    { workspace: 'halden', name: 'Halden' }, { id: 'notes' }, { workspace: 'team' }, { workspace: '../up', name: 'Up' }, { name: 'Nowhere' },
    { id: 'board', workspace: 'team' },
  ] }\n`)
  const host = await quiet(() => loadHost(file, DIR, {}))
  const user = await host.gate({ headers: {} }, { id: 'local', workspaces: [] }, async (req, d) => d)
  assert.deepEqual(user.workspaces, [
    { id: 'global', modules: [{ id: 'notes', meta: {} }] },
    { id: 'halden', name: 'Halden', modules: [] },
    { id: 'team', modules: [{ id: 'board', meta: {} }] },
  ])
})

test("an app with an origin may be listed in two workspaces, an entry in each with the origin, and the bootstrap names the global workspace its frame lives in for a host with no pages", async () => {
  const file = put('two.js', `export function sidebar() { return [
    { id: 'notes', origin: 'https://m-notes.apps.example', workspace: 'halden' }, { id: 'notes', origin: 'https://m-notes.apps.example', workspace: 'team' },
  ] }\n`)
  const host = await quiet(() => loadHost(file, DIR, {}))
  const user = await host.gate({ headers: {} }, { id: 'local', workspaces: [] }, async (req, d) => d)
  const notes = { id: 'notes', meta: {}, origin: 'https://m-notes.apps.example' }
  assert.deepEqual(user.workspaces, [{ id: 'global', modules: [] }, { id: 'halden', modules: [notes] }, { id: 'team', modules: [notes] }])
  assert.deepEqual(host.bootstrap(), { globalWorkspace: 'global' })
})

test("a page says which workspaces list it, the global one or the others, none for every one; the bootstrap carries it and any other word stops the load", async () => {
  put('w/home.jsx', 'export default () => null\n')
  put('w/plans.jsx', 'export default () => null\n')
  put('w/agents.jsx', 'export default () => null\n')
  const file = put('listed.js', `export const pages = { '/': { title: 'Home', file: './w/home.jsx' }, '/agents': { title: 'Agents', file: './w/agents.jsx', workspaces: 'global' },
    '/plans': { title: 'Plans', file: './w/plans.jsx', workspaces: 'others' } }\n`)
  const host = await quiet(() => loadHost(file, DIR, {}))
  assert.deepEqual(host.bootstrap(), { globalWorkspace: 'global', pages: [
    { path: '/', title: 'Home', src: '/_atelier/pages/home.js' },
    { path: '/agents', title: 'Agents', src: '/_atelier/pages/agents.js', workspaces: 'global' },
    { path: '/plans', title: 'Plans', src: '/_atelier/pages/plans.js', workspaces: 'others' },
  ] })
  const wrong = put('wrong.js', `export const pages = { '/plans': { title: 'Plans', file: './w/plans.jsx', workspaces: 'halden' } }\n`)
  await assert.rejects(loadHost(wrong, DIR, {}), /pages: "\/plans": workspaces is 'global' or 'others'/)
})

test("the host's person() replaces the auth slot, and the caller is the host's header when it sends one, else the person", async () => {
  const file = put('person.js', `export function person(req) { return req.headers.cookie === 'alex' ? { person: 'alex', name: 'Alex' } : null }\n`)
  const host = await quiet(() => loadHost(file, DIR, {}))
  const slot = async () => { throw new Error('the auth slot is not asked under a host that names the person') }
  assert.equal(await host.gate({ headers: {} }, { workspaces: [] }, slot), null)
  const req = { headers: { cookie: 'alex' } }
  assert.deepEqual(await host.gate(req, { workspaces: [{ id: 'global', modules: [] }] }, slot), { id: 'alex', name: 'Alex', workspaces: [{ id: 'global', modules: [] }] })
  assert.deepEqual(host.callerFor(req), { person: 'alex', name: 'Alex' })
  const sent = Buffer.from(JSON.stringify({ person: 'sam' })).toString('base64url')
  assert.deepEqual(host.callerFor({ headers: { 'x-atelier-caller': sent } }), { person: 'sam' })
})

test('a host file the shell cannot load, or pages in two folders, is refused with the file and the reason', async () => {
  await assert.rejects(loadHost('./missing.js', DIR, {}), /could not load .*missing\.js/)
  put('a/home.jsx', 'export default () => null\n')
  put('b/about.jsx', 'export default () => null\n')
  const file = put('pages.js', `export const pages = { '/': { title: 'Home', file: './a/home.jsx' }, '/about': { title: 'About', file: './b/about.jsx' } }\n`)
  await assert.rejects(loadHost(file, DIR, {}), /could not load .*pages\.js: pages: every page file lives in one folder/)
})
