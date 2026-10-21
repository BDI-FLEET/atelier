// backend-procs.js with a stand-in for node's fork: each process is a fake child that answers the shell's messages when
// the test lets it, so a start, a reload and a stop can be raced in a known order and the live processes counted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createBackendProcs } from '../backend-procs.js'

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

/* The shell's side with fake children; `hold()` makes the next bundle wait until the promise it returns is let go. */
function seam() {
  const children = [], told = [], holds = []
  const procs = createBackendProcs({
    hostDir: '/nowhere', auth: null, label: null, port: 0, host: '127.0.0.1', baseUrl: 'http://localhost',
    bundle: async () => { const h = holds.shift(); if (h) await h; return '' },
    fork: () => { const c = new FakeChild(1000 + children.length); children.push(c); return c },
    broadcast: () => {}, setError: (...a) => told.push(['error', ...a]), clearError: (qid) => told.push(['clear', qid]), enrichError: (e) => String(e),
  })
  const hold = () => { let go; holds.push(new Promise((r) => { go = r })); return go }
  const live = () => children.filter((c) => c.alive)
  return { procs, children, told, hold, live }
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
