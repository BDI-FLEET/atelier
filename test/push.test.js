// atelier create / remote / computers / push (create.js, remote.js, computers.js, push.js, and inside a sandbox the
// computer's socket through sandbox.js) — exercised through the real CLI
// against an in-process fake host: the host's API (computers, the push token)
// and a receiver that is git's own http-backend behind the token check, its
// pre-receive hook printing the receiver's lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.resolve(HERE, '..', 'cli.js')
const SECRET = 'sess_test_7c2e9a1f4b6d8e0a3c5f7b9d1e2a4c6e'
const TOKEN = 'push_4f8a2c6e0b1d3f5a7c9e2b4d6f8a0c1e'
const NO_GRANT = 'the grant is missing: maintain on example-co'
const COMPUTERS = [
  { id: 'computer:5d1a', label: 'alex-sam', kind: 'chat', line: 'your chat with Sam', modules: 2 },
  { id: 'computer:9b3e', label: 'alex', kind: 'own', line: 'your own', modules: 1 },
  { id: 'computer:2c7f', label: 'example-co', kind: 'room', line: 'shared with your team', modules: 0 },
]

const LIVE = `#!/bin/sh
read old new ref
c=$(git rev-parse --short=7 "$new")
echo "-----> reading-list: building $c"
echo "-----> runtime started"
echo "-----> live: reading-list @ $c"
`
const REFUSE = `#!/bin/sh
read old new ref
echo "-----> release script: exited 1"
echo "       Error: column \\"owner\\" already exists"
echo " !     data restored from the backup; reading-list stays where it was"
exit 1
`

// git, quietly, as nobody in particular
const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).stdout.trim()

async function fakeHost() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-receiver-'))
  const bare = path.join(root, 'git', 'alex', 'reading-list.git')
  fs.mkdirSync(bare, { recursive: true })
  g(bare, 'init', '-q', '--bare')
  const hook = (text) => fs.writeFileSync(path.join(bare, 'hooks', 'pre-receive'), text, { mode: 0o755 })
  hook(LIVE)
  const calls = []
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    calls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization || null })
    if (u.pathname.startsWith('/git/')) {
      // the receiver: no password yet → ask for one; the token as atelier's password → git's own backend
      if (!req.headers.authorization) { res.writeHead(401, { 'www-authenticate': 'Basic realm="atelier"' }); return res.end() }
      if (req.headers.authorization !== `Basic ${Buffer.from(`atelier:${TOKEN}`).toString('base64')}`) { res.writeHead(403); return res.end() }
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
    if (req.method === 'POST' && u.pathname === '/api/push/token') {
      if (body.computer !== 'alex') return send(403, { error: NO_GRANT })
      return send(201, { token: TOKEN, expires: new Date(Date.now() + 300_000).toISOString(),
        url: `${host}/git/${body.computer}/${body.module}.git` })
    }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const host = `http://127.0.0.1:${server.address().port}`
  return { url: host, bare, hook, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

// a home: signed in at the host (or not), a temp folder of its own for the push's helper
function home(host) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-push-home-'))
  fs.mkdirSync(path.join(h, 'tmp'))
  if (host) {
    fs.mkdirSync(path.join(h, '.config', 'atelier'), { recursive: true, mode: 0o700 })
    fs.writeFileSync(path.join(h, '.config', 'atelier', 'credentials'),
      JSON.stringify({ [host]: { session: SECRET, expires: '2026-12-31T00:00:00Z', person: { id: 'p_alex', name: 'Alex' } } }), { mode: 0o600 })
  }
  return h
}

function cli(h, cwd, args, host, sandbox) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: h, TMPDIR: path.join(h, 'tmp') }
    delete env.XDG_CONFIG_HOME
    if (host) env.ATELIER_HOST = host; else delete env.ATELIER_HOST
    delete env.ATELIER_SOCKET; delete env.ATELIER_SANDBOX
    if (sandbox) Object.assign(env, sandbox)
    const p = spawn(process.execPath, [CLI, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', (code) => resolve({ code, stdout, stderr, out: stdout + stderr }))
  })
}

// a module folder with one commit and, when given, the remote atelier
function moduleFolder(h, remote) {
  const dir = path.join(h, 'reading-list')
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'module.json'), '{ "name": "Reading List" }\n')
  g(dir, 'init', '-q', '-b', 'main'); g(dir, 'add', '.'); g(dir, 'commit', '-q', '-m', 'first')
  if (remote) g(dir, 'remote', 'add', 'atelier', remote)
  return dir
}

test('a push is a git push with a one-push token whose answer is printed as remote: lines, a refused release exits 1 with the live commit kept, and going back is a push of an older commit', async () => {
  const host = await fakeHost()
  const h = home(host.url)
  try {
    const dir = moduleFolder(h, `${host.url}/git/alex/reading-list.git`)
    const sha = g(dir, 'rev-parse', 'HEAD'), short = sha.slice(0, 7)

    const r = await cli(h, dir, ['push'])
    assert.equal(r.code, 0, r.out)
    assert.match(r.stderr, new RegExp(`remote: -----> reading-list: building ${short}\\s*\\nremote: -----> runtime started\\s*\\nremote: -----> live: reading-list @ ${short}`))
    assert.match(r.stderr, /\* \[new branch\]\s+\S+ -> main/)
    assert.equal(r.stdout, 'in your sidebar on the portal\n')
    assert.equal(g(host.bare, 'rev-parse', 'main'), sha, 'the commit is the receiver\'s main')
    assert.deepEqual(host.calls.find((c) => c.path === '/api/push/token').body, { computer: 'alex', module: 'reading-list' })
    assert.ok(host.calls.some((c) => c.path.endsWith('/git-receive-pack') && c.auth), 'git sent the token as atelier\'s password')
    assert.ok(!r.out.includes(TOKEN), 'the token never reaches the terminal')
    assert.deepEqual(fs.readdirSync(path.join(h, 'tmp')), [], 'the helper is gone')

    // the receiver refuses: its lines still arrive, the exit is 1, the live commit stays
    host.hook(REFUSE)
    fs.writeFileSync(path.join(dir, 'backend.js'), 'export default {}\n')
    g(dir, 'add', '.'); g(dir, 'commit', '-q', '-m', 'second')
    const no = await cli(h, dir, ['push'])
    assert.equal(no.code, 1, no.out)
    assert.match(no.stderr, /remote: -----> release script: exited 1/)
    assert.match(no.stderr, /! \[remote rejected\]/)
    assert.equal(no.stdout, '')
    assert.equal(g(host.bare, 'rev-parse', 'main'), sha)

    // the release fixed, it goes live; going back is a push of the older commit
    host.hook(LIVE)
    assert.equal((await cli(h, dir, ['push'])).code, 0)
    const back = await cli(h, dir, ['push', 'atelier', short])
    assert.equal(back.code, 0, back.out)
    assert.match(back.stderr, new RegExp(`remote: -----> live: reading-list @ ${short}`))
    assert.equal(g(host.bare, 'rev-parse', 'main'), sha)
  } finally { await host.close() }
})

test('push, remote and computers keep the one exit convention: 2 written wrongly, 3 not signed in before anything is asked, 4 the grant is missing before any git request', async () => {
  const host = await fakeHost()
  try {
    const h = home(host.url)
    // 2 · outside a module folder; no remote atelier
    const outside = await cli(h, h, ['push'])
    assert.equal(outside.code, 2, outside.out)
    assert.match(outside.stderr, /not in a module folder/)
    const dir = moduleFolder(h, null)
    const noRemote = await cli(h, dir, ['push'])
    assert.equal(noRemote.code, 2)
    assert.match(noRemote.stderr, /remote "atelier" not set: atelier remote <computer>/)
    assert.equal((await cli(h, dir, ['remote'])).code, 2)

    // 4 · a computer you hold no grant on: the remote is not set; a push there is refused before git, the sentence the host's
    const notMine = await cli(h, dir, ['remote', 'nobodys'], host.url)
    assert.equal(notMine.code, 4, notMine.out)
    assert.match(notMine.stderr, /the grant is missing: maintain on nobodys/)
    g(dir, 'remote', 'add', 'atelier', `${host.url}/git/example-co/reading-list.git`)
    const refused = await cli(h, dir, ['push'])
    assert.equal(refused.code, 4, refused.out)
    assert.match(refused.stderr, new RegExp(NO_GRANT))
    assert.ok(!host.calls.some((c) => c.path.startsWith('/git/')), 'no git request was made')

    // 3 · not signed in at the remote's host: before any token is asked for
    const before = host.calls.length
    const h2 = home(null)
    const dir2 = moduleFolder(h2, `${host.url}/git/alex/reading-list.git`)
    const out = await cli(h2, dir2, ['push'])
    assert.equal(out.code, 3, out.out)
    assert.match(out.stderr, /not signed in at .* · atelier login/)
    assert.equal((await cli(h2, h2, ['computers'], host.url)).code, 3)
    assert.equal(host.calls.length, before, 'nothing was asked of the host')
  } finally { await host.close() }
})

// a computer's socket, as a sandbox has it: hello first, then `push`. Like the real one it
// holds the token itself and runs the git push from the sandbox's checkout, streaming git's lines back as `{ line }`, then
// `{ ok, code }`; or the host's sentence before any git runs
async function fakeComputer(dir) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-sock-')), 'computer.sock')
  const askpass = path.join(path.dirname(file), 'askpass')
  fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in Username*) echo atelier ;; *) head -n 1 <&3 ;; esac\n', { mode: 0o700 })
  const asked = []
  const server = net.createServer((c) => {
    let buf = '', cwd = ''
    c.setEncoding('utf8')
    c.on('data', (d) => {
      buf += d
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const r = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
        asked.push(r)
        const send = (a) => c.write(JSON.stringify({ ...a, id: r.id }) + '\n')
        if (r.verb === 'hello') {
          const ok = fs.realpathSync(r.cwd).startsWith(fs.realpathSync(dir))
          if (ok) cwd = r.cwd
          send(ok ? { ok: true, sandbox: r.sandbox, computer: 'computer:k1' } : { refused: 'not a sandbox of this computer' })
          continue
        }
        if (r.verb !== 'push') { send({ refused: 'not this verb' }); continue }
        const url = g(cwd, 'remote', 'get-url', r.remote || 'atelier')
        if (!url.endsWith('/git/alex/reading-list.git') || r.module !== 'reading-list') { send({ refused: NO_GRANT, status: 403 }); continue }
        const git = spawn('git', ['-c', 'credential.helper=', 'push', url, `+${r.commit}:refs/heads/main`],
          { cwd, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' } })
        git.stdio[3].end(`${TOKEN}\n`)
        for (const s of [git.stdout, git.stderr]) s.on('data', (x) => { for (const line of String(x).split(/\r?\n|\r/)) if (line.trim()) send({ line }) })
        git.on('close', (code) => send({ ok: true, code }))
      }
    })
  })
  await new Promise((r) => server.listen(file, r))
  return { env: { ATELIER_SOCKET: file, ATELIER_SANDBOX: 'sandbox:3d9f04' }, asked, close: () => new Promise((r) => server.close(r)) }
}

test('inside a sandbox, push asks the computer to push: no session, no token in the CLI, the same remote: lines and exit codes', async () => {
  const host = await fakeHost()
  const h = home(null)   // a sandbox's home: never signed in
  const sup = await fakeComputer(h)
  try {
    const dir = moduleFolder(h, `${host.url}/git/alex/reading-list.git`)
    const sha = g(dir, 'rev-parse', 'HEAD'), short = sha.slice(0, 7)
    const r = await cli(h, dir, ['push'], null, sup.env)
    assert.equal(r.code, 0, r.out)
    assert.match(r.stderr, new RegExp(`remote: -----> live: reading-list @ ${short}`))
    assert.equal(r.stdout, 'in your sidebar on the portal\n')
    assert.equal(g(host.bare, 'rev-parse', 'main'), sha)
    assert.deepEqual(sup.asked.map((x) => x.verb), ['hello', 'push'])
    assert.deepEqual({ module: sup.asked[1].module, remote: sup.asked[1].remote, commit: sup.asked[1].commit }, { module: 'reading-list', remote: 'atelier', commit: sha })
    assert.ok(!host.calls.some((c) => c.path === '/api/push/token'), 'the host was not asked: a sandbox has no session')
    assert.ok(!r.out.includes(TOKEN), 'the token never reaches the terminal')
    assert.deepEqual(fs.readdirSync(path.join(h, 'tmp')), [], 'no helper was made in the sandbox')
    // the host's sentence: 4, nothing pushed
    g(dir, 'remote', 'set-url', 'atelier', `${host.url}/git/example-co/reading-list.git`)
    const no = await cli(h, dir, ['push'], null, sup.env)
    assert.equal(no.code, 4, no.out)
    assert.match(no.stderr, new RegExp(NO_GRANT))
    assert.equal(g(host.bare, 'rev-parse', 'main'), sha)
  } finally { await sup.close(); await host.close() }
})

// a computer's socket that takes the hello and refuses every request with `refusal`
async function refusingComputer(refusal) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-sock-')), 'computer.sock')
  const server = net.createServer((c) => {
    let buf = ''
    c.setEncoding('utf8')
    c.on('data', (d) => {
      buf += d
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const r = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
        c.write(JSON.stringify(r.verb === 'hello' ? { ok: true, sandbox: r.sandbox, id: r.id } : { ...refusal, id: r.id }) + '\n')
      }
    })
  })
  await new Promise((r) => server.listen(file, r))
  return { env: { ATELIER_SOCKET: file, ATELIER_SANDBOX: 'sandbox:3d9f04' }, close: () => new Promise((r) => server.close(r)) }
}

test('inside a sandbox a refusal on the socket exits by its status, never by its words: 403 exits 4, 400 exits 2, one without a status 1', async () => {
  const h = home(null)
  const dir = moduleFolder(h, 'http://127.0.0.1:9/git/alex/reading-list.git')
  const cases = [
    [{ refused: 'nothing of yours runs here', status: 403 }, 4],
    [{ refused: `${NO_GRANT}, as the computer reads it`, status: 400 }, 2],
    [{ refused: NO_GRANT }, 1],
  ]
  for (const [refusal, code] of cases) {
    const computer = await refusingComputer(refusal)
    try {
      const r = await cli(h, dir, ['push'], null, computer.env)
      assert.equal(r.code, code, r.out)
      assert.ok(r.stderr.includes(refusal.refused), 'the sentence is kept for the person')
    } finally { await computer.close() }
  }
})

test('create makes a module repository with the remote atelier set to your own computer', async () => {
  const host = await fakeHost()
  try {
    const h = home(host.url)
    const r = await cli(h, h, ['create', 'reading-list'], host.url)
    assert.equal(r.code, 0, r.out)
    assert.equal(r.stdout, 'project reading-list · in your space · remote "atelier" set\n')
    const dir = path.join(h, 'reading-list')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8')), { name: 'reading-list' })
    assert.ok(fs.existsSync(path.join(dir, 'frontend.jsx')) && fs.existsSync(path.join(dir, 'backend.js')))
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^data\/$/m)
    assert.equal(g(dir, 'log', '--format=%s'), 'atelier create reading-list')
    assert.equal(g(dir, 'remote', 'get-url', 'atelier'), `${host.url}/git/alex/reading-list.git`)
    assert.equal((await cli(h, h, ['create', 'reading-list'], host.url)).code, 2, 'the folder exists')
  } finally { await host.close() }
})
