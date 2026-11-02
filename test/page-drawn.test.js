// A click in place between the host's pages, as the shell switches them: what is on screen after each click, with a page's
// code arriving late, and a page whose code is loaded drawn by real React in the first render of its host page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { pageLoader, pageDrawn } from '../page-drawn.js'
import { served } from './ours.js'

globalThis.React = React
globalThis.window = { __ATELIER__: {} }
const hostPages = await served('host-pages.jsx')

const page = (path) => ({ path, src: `/_atelier/pages${path}.js` })
const HOME = page('/home'), AGENTS = page('/agents'), APPS = page('/apps'), BROKEN = page('/broken')

/** Imports held until the test lets each one arrive: what a round trip to the box does to a page's code. */
function slowImports() {
  const held = new Map()
  const arrival = (src) => { if (!held.has(src)) { let settle; const p = new Promise((resolve, reject) => { settle = { resolve, reject } }); held.set(src, { p, ...settle }) } return held.get(src) }
  return { importPage: (src) => arrival(src).p, arrive: (src) => arrival(src).resolve(() => null), fail: (src, err) => arrival(src).reject(err) }
}

/** The shell's page switch: each click asks its host page for a page, which draws from the loader and what it drew before. */
function shell(loader) {
  let before = null
  return (p, props) => {
    const drawn = pageDrawn({ ...p, key: p.path, props }, loader.settled(p.src), before)
    if (!loader.settled(p.src)) loader.load(p.src)
    before = drawn
    return drawn
  }
}

test('a page whose code has not arrived keeps the page drawn before on screen until it does, so a click in place never empties the page', async () => {
  const net = slowImports(), loader = pageLoader(net.importPage), click = shell(loader)
  net.arrive(HOME.src)
  await loader.load(HOME.src)
  const home = click(HOME, { path: HOME.path })
  assert.equal(home.key, HOME.path)
  assert.equal(click(AGENTS, { path: AGENTS.path }), home)
  await tick()
  assert.equal(click(AGENTS, { path: AGENTS.path }), home)
  net.arrive(AGENTS.src)
  await loader.load(AGENTS.src)
  const agents = click(AGENTS, { path: AGENTS.path })
  assert.deepEqual([agents.key, agents.props], [AGENTS.path, { path: AGENTS.path }])
  assert.equal(click(APPS, { path: APPS.path }), agents)
})

test('a page whose code has arrived once draws at its next click, and a page whose code failed shows its failure once the import is refused', async () => {
  const net = slowImports(), loader = pageLoader(net.importPage), click = shell(loader)
  for (const p of [HOME, AGENTS]) { net.arrive(p.src); await loader.load(p.src) }
  assert.equal(click(HOME, {}).key, HOME.path)
  assert.equal(click(AGENTS, {}).key, AGENTS.path)
  assert.equal(click(HOME, {}).key, HOME.path)
  const agents = click(AGENTS, {})
  assert.equal(click(BROKEN, {}), agents)
  net.fail(BROKEN.src, new Error('refused'))
  await loader.load(BROKEN.src)
  assert.deepEqual(click(BROKEN, {}), { key: BROKEN.path, path: BROKEN.path, failed: new Error('refused') })
  const SILENT = page('/silent')
  click(SILENT, {})
  net.fail(SILENT.src, undefined)
  await loader.load(SILENT.src)
  assert.deepEqual(click(SILENT, {}), { key: SILENT.path, path: SILENT.path, failed: undefined })
})

test("a host page whose code is loaded is drawn in its host page's first render, with the props the shell hands it", async () => {
  const src = `data:text/javascript,${encodeURIComponent("export default function Agents({ workspace }) { return React.createElement('p', null, 'Agents in ' + workspace) }")}`
  await hostPages.loadHostPage(src)
  const html = renderToString(React.createElement(hostPages.HostPage, { page: { path: '/agents', src }, qid: 'halden/agents', props: { workspace: 'halden' } }))
  assert.equal(html, '<p>Agents in halden</p>')
})
