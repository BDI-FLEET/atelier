// atelier login / whoami / logout (login.js, whoami.js, logout.js) — the identity verbs, exercised through the
// real CLI against an in-process fake of the host API's routes: the session
// kept private and never printed, whoami in words, sign-out ends it on the host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { screen, SCENE, SCENE_WIDTH } from '../login-screen.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')
const NUMBER = '+15555550100'
const CODE = '123456'
const SECRET = 'sess_test_9f3c2a7d1e5b4c60a8d2f1e3b7c9a0d4'
const HANDLE = 'h_2b8e0c4f6a1d3e5f7a9b0c2d4e6f8a1b'

// The fake host: one person, one code, sessions it handed out.
async function fakeHost() {
  const sessions = new Set()
  const calls = []
  const activation = { polls: 0, spent: false, machine: null }
  const server = http.createServer(async (req, res) => {
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : {}
    calls.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null })
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const sessionOf = () => (req.headers.authorization || '').replace(/^Session /, '')
    if (req.method === 'POST' && req.url === '/api/login') return send(202, { sent: true })
    if (req.method === 'POST' && req.url === '/api/login/code') {
      if (body.number !== NUMBER || body.code !== CODE) return send(401, { refused: 'That code is not the one we sent.' })
      sessions.add(SECRET)
      return send(200, { session: SECRET, expires: '2026-10-31T12:00:00.000Z', person: { id: 'p_alex', name: 'Alex' } })
    }
    if (req.method === 'GET' && req.url === '/api/whoami') {
      if (!sessions.has(sessionOf())) return send(401, { refused: 'No session.' })
      return send(200, { person: { id: 'p_alex', name: 'Alex' }, expires: '2026-10-31T12:00:00.000Z',
        grants: ['chat:c2d8e1#member@person:7f3a2c', 'sandbox:3d9f04#watch@person:7f3a2c', 'session:5e55aa#of@person:7f3a2c'] })
    }
    // the activation: a code for the machine, waiting until the person approves it on the page, then the session once
    if (req.method === 'POST' && req.url === '/api/activate/new') {
      activation.machine = body.machine
      return send(201, { code: 'DOJ83-KKIUQ', handle: HANDLE, expires: new Date(Date.now() + 600_000).toISOString() })
    }
    if (req.method === 'GET' && req.url === `/api/activate/${HANDLE}`) {
      if (activation.spent) return send(200, { state: 'spent' })
      if (++activation.polls < 2) return send(200, { state: 'waiting' })
      activation.spent = true
      sessions.add(SECRET)
      return send(200, { state: 'approved', session: SECRET, expires: '2026-10-31T12:00:00.000Z', person: { id: 'p_alex', name: 'Alex' } })
    }
    if (req.method === 'POST' && req.url === '/api/logout') {
      if (!sessions.delete(sessionOf())) return send(401, { refused: 'No session.' })
      return send(200, { ok: true })
    }
    send(404, { refused: 'No such route.' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls, sessions, activation,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }),
  }
}

// A browser that only writes down what it was asked to open: the login opens the link itself, and a test must never
// open a real one on the machine running it ($BROWSER is the opener's first choice, login-screen.js).
function fakeBrowser(home) {
  const bin = path.join(home, 'browser.sh')
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$1" > "${path.join(home, 'opened')}"\n`, { mode: 0o755 })
  return bin
}
async function opened(home) {
  const f = path.join(home, 'opened')
  for (let i = 0; i < 50 && !fs.existsSync(f); i++) await new Promise((r) => setTimeout(r, 50))
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null
}

// async spawn — spawnSync would block the fake host living in this process
function cli(home, args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, HOME: home, BROWSER: fakeBrowser(home), ...env }
    if (!('ATELIER_HOST' in env)) delete childEnv.ATELIER_HOST
    if (!('XDG_CONFIG_HOME' in env)) delete childEnv.XDG_CONFIG_HOME
    delete childEnv.ATELIER_NETWORK
    const p = spawn(process.execPath, [CLI, ...args], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }))
    if (input != null) p.stdin.write(input)
    p.stdin.end()
  })
}

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-login-'))
const credFile = (home) => path.join(home, '.config', 'atelier', 'credentials')
const creds = (home) => JSON.parse(fs.readFileSync(credFile(home), 'utf8'))

test('the session is kept private, per host (0600 in a 0700 folder), and never reaches the terminal', async () => {
  const host = await fakeHost()
  const home = tmpHome()
  try {
    const r = await cli(home, ['login', '--host', host.url, '--network', 'fake', NUMBER, '--code', CODE])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stdout, /signed in as Alex/)
    assert.ok(!r.out.includes(SECRET), 'the session must never reach the terminal')
    assert.equal(creds(home)[host.url].session, SECRET)
    assert.equal(fs.statSync(credFile(home)).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(credFile(home))).mode & 0o777, 0o700)
  } finally { await host.close() }
})

test('the credentials live under XDG_CONFIG_HOME when it is set, else under ~/.config', async () => {
  const host = await fakeHost()
  const home = tmpHome()
  const config = path.join(home, 'elsewhere')
  try {
    const env = { XDG_CONFIG_HOME: config }
    assert.equal((await cli(home, ['login', '--host', host.url, '--network', 'fake', NUMBER, '--code', CODE], { env })).code, 0)
    assert.equal(JSON.parse(fs.readFileSync(path.join(config, 'atelier', 'credentials'), 'utf8'))[host.url].session, SECRET)
    assert.ok(!fs.existsSync(credFile(home)), 'nothing under ~/.config')
    assert.equal((await cli(home, ['whoami', '--host', host.url], { env })).code, 0)
    assert.equal((await cli(home, ['whoami', '--host', host.url])).code, 3, 'without it, ~/.config holds no session')
  } finally { await host.close() }
})

test('whoami says in words who this machine acts as and where; never a raw grant line, never the session', async () => {
  const host = await fakeHost()
  const home = tmpHome()
  try {
    assert.equal((await cli(home, ['login', '--host', host.url, '--network', 'fake', NUMBER, '--code', CODE])).code, 0)
    const g = await cli(home, ['whoami', '--grants', '--host', host.url])
    assert.equal(g.code, 0, g.out)
    assert.match(g.stdout, new RegExp(`acting as Alex · at ${host.url}\n    a member of chat:c2d8e1\n    may watch sandbox:3d9f04\n`))
    assert.ok(!g.stdout.includes('#'), 'no raw grant line')
    assert.ok(!g.out.includes(SECRET))
  } finally { await host.close() }
})

test('sign-out is one revoke: logout ends the session on the host and forgets it here', async () => {
  const host = await fakeHost()
  const home = tmpHome()
  try {
    assert.equal((await cli(home, ['login', '--host', host.url, '--network', 'fake', NUMBER, '--code', CODE])).code, 0)
    const r = await cli(home, ['logout', '--host', host.url])
    assert.equal(r.code, 0, r.out)
    assert.equal(host.sessions.size, 0)
    assert.equal(creds(home)[host.url], undefined)
    assert.equal((await cli(home, ['whoami', '--host', host.url])).code, 3)
  } finally { await host.close() }
})

test('atelier login without a number activates through the portal and stores the session', async () => {
  const host = await fakeHost()
  const home = tmpHome()
  try {
    const r = await cli(home, ['login', '--host', host.url])
    assert.equal(r.code, 0, r.out)
    // no terminal here: the words of the screen only, the browser opened on the link with the code in it
    const version = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'package.json'), 'utf8')).version
    const link = `${host.url}/activate?code=DOJ83-KKIUQ`
    assert.equal(r.stdout, `Welcome to the atelier · ${version}\n\n`
      + `This signs this terminal in to your atelier at ${host.url}: approve it in the browser that just opened.\n\n`
      + `Browser didn't open? Use the link below\n${link}\nCode DOJ83-KKIUQ\n\nwaiting … signed in as Alex\n`)
    assert.equal(await opened(home), link)
    assert.equal(host.activation.machine, os.hostname().replace(/\.local$/, ''))
    assert.ok(!r.out.includes(SECRET) && !r.out.includes(HANDLE), 'the session and the handle never reach the terminal')
    assert.equal(creds(home)[host.url].session, SECRET)
    assert.match((await cli(home, ['whoami', '--host', host.url])).stdout, new RegExp(`acting as Alex · at ${host.url}`))
  } finally { await host.close() }
})

test('the login screen: the title, a horse in block characters, the link with the code, the code; --plain the words alone', async () => {
  const link = 'http://127.0.0.1:4350/activate?code=DOJ83-KKIUQ'
  const drawn = screen({ version: '0.22.0', host: 'http://127.0.0.1:4350', link, code: 'DOJ83-KKIUQ', opened: true, canCopy: true, art: true })
  const bare = drawn.replace(/\x1b\[[0-9;]*m/g, '')
  assert.match(bare, /^Welcome to the atelier · 0\.22\.0\n/)
  assert.ok(bare.includes(link + '\n') && bare.includes('Code DOJ83-KKIUQ\n'))
  assert.ok(bare.includes("Browser didn't open? Use the link below (c to copy)"))
  assert.ok(/[▀▄█]/.test(bare), 'the scene is drawn in block characters')
  // the scene: two pixel rows a line, every line as wide as the rules around it, every letter a colour of the palette
  assert.ok(SCENE.every((row) => row.length === SCENE_WIDTH && /^[.*adkgcCm]+$/.test(row)))
  const lines = bare.split('\n'), rule = '·'.repeat(SCENE_WIDTH)
  const top = lines.indexOf(rule), bottom = lines.indexOf(rule, top + 1)
  assert.equal(bottom - top - 1, SCENE.length / 2)
  assert.ok(lines.slice(top + 1, bottom).every((l) => [...l].length === SCENE_WIDTH))
  assert.ok(!/paste|enter the code/i.test(bare), 'nothing is typed back into the terminal in this flow')

  // the real CLI with --plain and --no-browser: no colour, no block character, nothing opened
  const host = await fakeHost()
  const home = tmpHome()
  try {
    const r = await cli(home, ['login', '--host', host.url, '--plain', '--no-browser'])
    assert.equal(r.code, 0, r.out)
    assert.ok(!/[▀▄█\x1b]/.test(r.stdout), 'no block character and no colour')
    assert.ok(r.stdout.includes(`${host.url}/activate?code=DOJ83-KKIUQ\nCode DOJ83-KKIUQ\n`))
    assert.match(r.stdout, /open the link below in a browser where you are signed in/)
    assert.match(r.stdout, /waiting … signed in as Alex\n$/)
    assert.equal(await opened(home), null, '--no-browser opens nothing')
  } finally { await host.close() }
})
