// backend-procs.js with a stand-in for node's fork: each process is a fake child that answers the shell's messages when
// the test lets it, so a start, a reload and a stop can be raced in a known order and the live processes counted, and the
// watchdog runs a round when the test says, against BACKEND_LOOP_PINGS from limits.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createBackendProcs } from '../backend-procs.js'
import { BACKEND_LOOP_PINGS } from '../limits.js'

const QID = 'global/notes'
const notes = { id: 'notes', workspace: 'global', qualifiedId: QID, dir: '/nowhere' }

/* A child process that loads, mounts, answers pings and stops as backend-host.js does. */
class FakeChild extends EventEmitter {
  constructor(pid) { super(); this.pid = pid; this.alive = true; this.answersPings = true }
  send(msg) { setImmediate(() => this.answer(msg)); return true }
  answer(msg) {
    if (!this.alive) return
    if (msg.type === 'load') this.emit('message', { type: 'loaded' })
    else if (msg.type === 'mount') this.emit('message', { type: 'ready' })
    else if (msg.type === 'ping' && this.answersPings) this.emit('message', { type: 'pong' })
    else if (msg.type === 'stop') this.end(0, null)
  }
  kill(signal) { setImmediate(() => this.end(null, signal)); return true }
  end(code, signal) { if (!this.alive) return; this.alive = false; this.emit('exit', code, signal) }
}

/* A child that could not be forked, as node reports one: an error, no pid, and no exit after it. */
class UnforkedChild extends EventEmitter {
  constructor() { super(); this.pid = undefined; setImmediate(() => this.emit('error', Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' }))) }
  send() { return false }
  kill() { return false }
}

/* The shell's side with fake children; `hold()` makes the next bundle wait until the promise it returns is let go, and
 * `watch()` runs one round of the watchdog. */
function seam({ Child = FakeChild } = {}) {
  const children = [], told = [], holds = []
  let round = null
  const procs = createBackendProcs({
    hostDir: '/nowhere', auth: null, label: null, port: 0, host: '127.0.0.1', baseUrl: 'http://localhost',
    bundle: async () => { const h = holds.shift(); if (h) await h; return '' },
    fork: () => { const c = new Child(1000 + children.length); children.push(c); return c },
    every: (fn) => { round = fn },
    broadcast: () => {}, setError: (...a) => told.push(['error', ...a]), clearError: (qid) => told.push(['clear', qid]), enrichError: (e) => String(e),
  })
  const hold = () => { let go; holds.push(new Promise((r) => { go = r })); return go }
  const live = () => children.filter((c) => c.alive)
  const watch = async (rounds = 1) => { for (let i = 0; i < rounds; i++) { round(); await settle() } }
  return { procs, children, told, hold, live, watch }
}
const settle = () => new Promise((r) => setImmediate(r))

test('a reload that lands while the first start is still loading leaves one live process, the one whose load began last', async (t) => {
  const said = t.mock.method(console, 'error', () => {})
  t.mock.method(console, 'log', () => {})
  const { procs, children, hold, live } = seam()
  const go = hold()
  const starting = procs.start(notes)
  await procs.reload(notes)
  go()
  assert.equal(await starting, false)
  await settle()
  assert.equal(children.length, 2)
  assert.deepEqual(live(), [children[0]], 'the reload forked first, as the start waited on its bundle, and its process is kept')
  assert.deepEqual(said.mock.calls.map((c) => c.arguments[0]), [`  ! ${QID}: two processes after a race · kept pid 1000, its load began last · stopped pid 1001`])
  procs.stopAll()
})

test('a stop while the first start is loading leaves no process, as the start discards what it loaded', async (t) => {
  t.mock.method(console, 'log', () => {})
  const { procs, children, hold, live } = seam()
  const go = hold()
  const starting = procs.start(notes)
  await procs.stop(QID)
  go()
  assert.equal(await starting, false)
  await settle()
  assert.equal(children.length, 1)
  assert.deepEqual(live(), [])
  assert.deepEqual([...procs.ids()], [])
  procs.stopAll()
})

test('a stop while a reload is loading leaves no process, as the reload discards what it loaded', async (t) => {
  t.mock.method(console, 'log', () => {})
  const { procs, children, hold, live } = seam()
  assert.equal(await procs.start(notes), true)
  const go = hold()
  const reloading = procs.reload(notes)
  await procs.stop(QID)
  go()
  await reloading
  await settle()
  assert.equal(children.length, 2)
  assert.deepEqual(live(), [])
  assert.deepEqual([...procs.ids()], [])
  procs.stopAll()
})

test('a process that cannot be forked ends the wait, and the mount fails with the error\'s words', { timeout: 5000 }, async (t) => {
  const said = t.mock.method(console, 'error', () => {})
  const { procs, told } = seam({ Child: UnforkedChild })
  assert.equal(await procs.start(notes), false)
  const sentence = 'the backend process could not start: spawn EAGAIN'
  assert.deepEqual(told, [['error', QID, sentence, 'load']])
  assert.deepEqual(said.mock.calls.map((c) => c.arguments[0]), [`  ! ${QID}: backend failed to load — ${sentence}`])
  assert.deepEqual([...procs.ids()], [])
  procs.stopAll()
})

test('a process that leaves BACKEND_LOOP_PINGS pings in a row unanswered is killed as a loop, and a pong starts the count again', async (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  const { procs, children, told, watch } = seam()
  assert.equal(await procs.start(notes), true)
  const [child] = children
  child.answersPings = false
  await watch(BACKEND_LOOP_PINGS - 1)
  child.answersPings = true
  await watch()
  child.answersPings = false
  await watch(BACKEND_LOOP_PINGS)
  assert.equal(child.alive, true, 'the pong before these pings started the count again')
  await watch()
  assert.equal(child.alive, false)
  assert.deepEqual(told.at(-1), ['error', QID, `This module's backend left ${BACKEND_LOOP_PINGS} pings in a row unanswered (a loop?) and was killed.`, 'crash'])
  procs.stopAll()
})

test('a sleep of the machine kills nothing: the clock moves a day between two rounds and the process that answers stays', async (t) => {
  t.mock.method(console, 'log', () => {})
  t.mock.timers.enable({ apis: ['Date'] })
  const { procs, children, told, watch } = seam()
  assert.equal(await procs.start(notes), true)
  const [child] = children
  await watch()
  t.mock.timers.setTime(Date.now() + 24 * 3600 * 1000)
  await watch()
  assert.equal(child.alive, true)
  assert.deepEqual(told, [['clear', QID]])
  procs.stopAll()
})
