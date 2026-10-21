// atelier clone (clone.js) — a maintainer gets an app's code from the host's git, never its data. Exercised through the real CLI
// against an in-process fake host: its API (computers, the clone token) and its git, git's own http-backend behind the
// token check, as push.test.js fakes the receiver.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')
const SECRET = 'sess_test_5b1d7f3a9c2e4b6d8f0a1c3e5b7d9f2a'
const TOKEN = 'clone_8e2a4c6f0b1d3e5a7c9f2b4d6e8a0c1f'
const NO_GRANT = 'the grant is missing: maintain on budget'
const COMPUTERS = [
  { id: 'computer:5d1a', label: 'alex-sam', kind: 'chat', line: 'your chat with Sam', modules: [{ name: 'Notes', label: 'notes', maintain: false }] },
  { id: 'computer:9b3e', label: 'alex', kind: 'own', line: 'your own', modules: [{ name: 'Reading List', label: 'reading-list', maintain: true }, { name: 'Notes', label: 'notes', maintain: false }] },
  { id: 'computer:2c7f', label: 'example-co', kind: 'room', line: 'shared with your team', modules: [{ name: 'Budget', label: 'budget', maintain: false }] },
]

// git, quietly, as nobody in particular
const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).stdout.trim()

async function fakeHost() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-git-'))
  // the app's repository on the host's git: one commit, no .gitignore (the clone writes one)
  const src = path.join(root, 'src')
  fs.mkdirSync(src)
  fs.writeFileSync(path.join(src, 'module.json'), '{ "name": "Reading List" }\n')
  fs.writeFileSync(path.join(src, 'backend.js'), 'export default {}\n')
  g(src, 'init', '-q', '-b', 'main'); g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'first')
  const bare = path.join(root, 'git', 'alex', 'reading-list.git')
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  g(root, 'clone', '-q', '--bare', src, bare)
  const calls = []
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    calls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || null })
    if (u.pathname.startsWith('/git/')) {
      // the host's git: a read only; no password yet → ask for one; the token as atelier's password → git's own backend
      if (!/git-upload-pack$/.test(u.pathname) && u.searchParams.get('service') !== 'git-upload-pack') { res.writeHead(403); return res.end() }
      if (!req.headers.authorization) { res.writeHead(401, { 'www-authenticate': 'Basic realm="atelier"' }); return res.end() }
      if (req.headers.authorization !== `Basic ${Buffer.from(`atelier:${TOKEN}`).toString('base64')}`) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('that clone token is not valid\n') }
      const cgi = spawn('git', ['http-backend'], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REMOTE_USER: 'atelier',
        PATH_INFO: u.pathname, QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method,
        CONTENT_TYPE: req.headers['content-type'] || '', HTTP_CONTENT_ENCODING: req.headers['content-encoding'] || '',
        ...(req.headers['content-length'] ? { CONTENT_LENGTH: req.headers['content-length'] } : {}) } })
      req.pipe(cgi.stdin)
      let head = Buffer.alloc(0), started = false
      cgi.stdout.on('data', (d) => {
        if (started) return res.write(d)
        head = Buffer.concat([head, d])
        const at = head.indexOf('\r\n\r\n')
        if (at < 0) return
        started = true
        const headers = {}
        let status = 200
        for (const l of head.subarray(0, at).toString().split('\r\n')) {
          const [k, ...v] = l.split(':')
          if (k.toLowerCase() === 'status') status = parseInt(v.join(':'), 10)
          else headers[k] = v.join(':').trim()
        }
        res.writeHead(status, headers)
        res.write(head.subarray(at + 4))
      })
      cgi.stdout.on('end', () => res.end())
      return
    }
    let raw = ''
    for await (const c of req) raw += c
    const body = raw ? JSON.parse(raw) : {}
    calls.at(-1).body = body
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { error: 'not signed in' })
    if (req.method === 'GET' && u.pathname === '/api/computers') return send(200, { computers: COMPUTERS })
    if (req.method === 'POST' && u.pathname === '/api/clone/token') {
      // the host's answer: maintain on reading-list at alex, nothing else
      if (body.computer !== 'alex' || body.module !== 'reading-list') return send(403, { error: `the grant is missing: maintain on ${body.module}` })
      return send(201, { token: TOKEN, expires: new Date(Date.now() + 300_000).toISOString(), url: `${host}/git/${body.computer}/${body.module}.git` })
    }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const host = `http://127.0.0.1:${server.address().port}`
  return { url: host, bare, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

// a home: signed in at the host (or not), a temp folder of its own for the clone's helper
function home(host) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-clone-home-'))
  fs.mkdirSync(path.join(h, 'tmp'))
  if (host) {
    fs.mkdirSync(path.join(h, '.config', 'atelier'), { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(h, '.config', 'atelier', 'credentials'),
      JSON.stringify({ [host]: { session: SECRET, expires: '2026-12-31T00:00:00Z', person: { id: 'p_alex', name: 'Alex' } } }), { mode: 0o600 })
  }
  return h
}

function cli(h, args, host, extra) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: h, TMPDIR: path.join(h, 'tmp') }
    delete env.XDG_CONFIG_HOME
    if (host) env.ATELIER_HOST = host; else delete env.ATELIER_HOST
    delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX
    if (extra) Object.assign(env, extra)
    const p = spawn(process.execPath, [CLI, ...args], { cwd: h, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }))
  })
}

test('a maintainer clones an app from the host\'s git: a clone token through the same one-off helper as a push, the remote atelier to its computer, a .gitignore for data/; one line, the token nowhere', async () => {
  const host = await fakeHost()
  const h = home(host.url)
  try {
    const r = await cli(h, ['clone', 'reading-list'], host.url)
    assert.equal(r.code, 0, r.out)
    const dir = path.join(h, 'reading-list'), short = g(host.bare, 'rev-parse', '--short=7', 'main')
    assert.equal(r.stdout, `cloned reading-list at ${short} · remote atelier → alex\n`)
    assert.equal(g(dir, 'rev-parse', 'HEAD'), g(host.bare, 'rev-parse', 'main'), 'the code at the main of the host\'s git')
    // the remote as `atelier remote` sets it, and no other: `atelier push` from here pushes back
    assert.equal(g(dir, 'remote'), 'atelier')
    assert.equal(g(dir, 'remote', 'get-url', 'atelier'), `${host.url}/git/alex/reading-list.git`)
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'data/\nnode_modules/\n')
    // the host asked for this app on the computer it runs on; git sent the token as atelier's password
    assert.deepEqual(host.calls.find((c) => c.path === '/api/clone/token').body, { computer: 'alex', module: 'reading-list' })
    assert.ok(host.calls.some((c) => c.path.endsWith('/git-upload-pack') && c.auth), 'git read with the token')
    // the token never reaches the terminal, the repository's config or a file that outlives git
    assert.ok(!r.out.includes(TOKEN), 'the token never reaches the terminal')
    assert.ok(!fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8').includes(TOKEN), 'the clone keeps no token')
    assert.deepEqual(fs.readdirSync(path.join(h, 'tmp')), [], 'the helper is gone')

    // into a folder named, and an empty one is fine
    fs.mkdirSync(path.join(h, 'rl'))
    const named = await cli(h, ['clone', 'reading-list', 'rl'], host.url)
    assert.equal(named.code, 0, named.out)
    assert.equal(g(path.join(h, 'rl'), 'rev-parse', 'HEAD'), g(host.bare, 'rev-parse', 'main'))
  } finally { await host.close() }
})

test('refused with the host\'s sentence when the person may not maintain the app (4); one answer for an app that is not there; 2 for a folder that exists or an app on two computers; 3 not signed in; a sandbox has its clone tool', async () => {
  const host = await fakeHost()
  try {
    const h = home(host.url)
    // 4 · the app runs on one of their computers, the host says they may not maintain it: its sentence, no git request, no folder
    const no = await cli(h, ['clone', 'budget'], host.url)
    assert.equal(no.code, 4, no.out)
    assert.match(no.stderr, new RegExp(NO_GRANT))
    assert.ok(!host.calls.some((c) => c.path.startsWith('/git/')), 'no git request was made')
    assert.ok(!fs.existsSync(path.join(h, 'budget')))
    // 4 · an app none of their computers runs: the same sentence, no token asked
    const before = host.calls.filter((c) => c.path === '/api/clone/token').length
    const nowhere = await cli(h, ['clone', 'ledger'], host.url)
    assert.equal(nowhere.code, 4, nowhere.out)
    assert.match(nowhere.stderr, /the grant is missing: maintain on ledger/)
    assert.equal(host.calls.filter((c) => c.path === '/api/clone/token').length, before)

    // 2 · notes runs on two of their computers and they maintain it on neither: name one; named, the host decides
    const two = await cli(h, ['clone', 'notes'], host.url)
    assert.equal(two.code, 2, two.out)
    assert.match(two.stderr, /notes runs on more than one of your computers \(alex-sam, alex\): atelier clone notes --computer <label>/)
    const named = await cli(h, ['clone', 'notes', '--computer', 'alex-sam'], host.url)
    assert.equal(named.code, 4, named.out)
    assert.deepEqual(host.calls.filter((c) => c.path === '/api/clone/token').at(-1).body, { computer: 'alex-sam', module: 'notes' })

    // 2 · the folder exists: before anything is asked
    fs.mkdirSync(path.join(h, 'reading-list')); fs.writeFileSync(path.join(h, 'reading-list', 'x'), 'x')
    const asked = host.calls.length
    const there = await cli(h, ['clone', 'reading-list'], host.url)
    assert.equal(there.code, 2, there.out)
    assert.match(there.stderr, /reading-list\/ exists already/)
    assert.equal((await cli(h, ['clone'], host.url)).code, 2)
    assert.equal(host.calls.length, asked, 'nothing was asked of the host')

    // 3 · not signed in at that host
    const h2 = home(null)
    const out = await cli(h2, ['clone', 'reading-list'], host.url)
    assert.equal(out.code, 3, out.out)
    assert.match(out.stderr, /not signed in at .* · atelier login/)
    assert.equal(host.calls.length, asked)

    // inside a sandbox: no session; the agent's clone tool clones
    const sb = await cli(h2, ['clone', 'reading-list'], null, { ATELIER_SOCKET: path.join(h2, 'nowhere.sock'), ATELIER_SANDBOX: 'sandbox:3d9f04' })
    assert.equal(sb.code, 2, sb.out)
    assert.match(sb.stderr, /inside a sandbox the clone tool clones an app/)
  } finally { await host.close() }
})
