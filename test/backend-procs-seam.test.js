// backend-procs.js on its own: what server.js hands createBackendProcs, and what the processes it starts answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBackendProcs } from '../backend-procs.js'

const HOST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mod = (id) => ({ id, workspace: 'global', qualifiedId: `global/${id}`, dir: HOST_DIR })

// fork() passes this process's flags to its child: the test runner's are not the shell's, so the child runs without them.
process.execArgv.length = 0

test("every backend but the configured auth module's runs in a process the shell starts, forwards to with what it decided, and stops at shutdown", async (t) => {
  const told = []
  const procs = createBackendProcs({
    hostDir: HOST_DIR, auth: 'gate', label: null, port: 0, host: '127.0.0.1', baseUrl: 'http://localhost',
    bundle: async () => `export default { mountRoutes(r, ctx) { r.get('/who', (q, s) => s.json({ pid: process.pid, caller: ctx.caller })) } }`,
    broadcast: () => {}, setError: (...a) => told.push(['error', ...a]), clearError: (qid) => told.push(['clear', qid]), enrichError: (e) => String(e),
  })
  assert.equal(procs.runsApart(mod('gate')), false)
  assert.equal(procs.runsApart(mod('notes')), true)
  assert.equal(await procs.start(mod('notes')), true)
  assert.deepEqual([...procs.ids()], ['global/notes'])
  assert.deepEqual(told, [['clear', 'global/notes']])

  const shell = http.createServer((req, res) => procs.proxy(req, res, 'global/notes', { user: { id: 'alex' }, caller: { person: 'alex', name: null } }))
  await new Promise((r) => shell.listen(0, '127.0.0.1', r))
  t.after(() => shell.close())
  const answer = await (await fetch(`http://127.0.0.1:${shell.address().port}/api/global/notes/who`)).json()
  assert.notEqual(answer.pid, process.pid)
  assert.deepEqual(answer.caller, { person: 'alex', name: null })

  assert.equal(procs.stopAll(), 1)
  await procs.stop('global/notes')
  assert.deepEqual([...procs.ids()], [])
})
