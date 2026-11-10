// atelier agent new --here (agent.js) and atelier agents (agents.js), with the folder an agent has on this machine
// (agent-folder.js) — exercised through the real CLI against a fake of the host's op routes and GET /api/agents: the
// agent is made by the same op with the same prompt as without --here, its id is the one the host's list of the person's
// agents answers, and the folder holds the prompt as CLAUDE.md and one file naming the agent, never the session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { homeAt, cli } from './adopt-host.js'
import { SECRET } from './files-host.js'

const OP = 'op-5e6f7a8b'
const MADE = 'agent k1/main/reviewer · made · held by the fleet · it answers the chat once `agent primary reviewer` names it'
const PROMPT = '# reviewer\n\nYou read pull requests and say what breaks.\n'
const RULES = 'the rules the fleet holds, never printed'
const REVIEWER = { id: 'agent:9b1c4e', name: 'reviewer' }
const NAMING = '.atelier-agent.json'

const agentOf = ({ id, name }, { exposures = [], primary = false } = {}) => ({
  id, name, computer: 'computer:k1', computerName: 'k1', tools: [], uses: [], rules: RULES, version: 1,
  exposures: exposures.map((n, i) => ({ to: `chat:c${i}`, name: n, mode: 'on-my-word', also: [], draft: false })), sandboxes: [],
  ...(primary ? { primary: true } : {}),
})

/* The host at `url`: the ops asked are kept in `asked`, what goes into them in `ins`, each GET of the person's agents in
 * `lists`. An agent-new op ends once its prompt went in, as the computer's does: `MADE` and `code`; on code 0 the agent
 * `made` joins the person's agents (none: the host made it and does not list it). */
async function agentsHost({ agents = [], code = 0, made = REVIEWER } = {}) {
  const asked = [], ins = [], lists = [], listed = [...agents]
  let stream = null
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString('utf8')
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const say = (f) => stream.write(JSON.stringify(f) + '\n')
    if (req.headers.authorization !== `Session ${SECRET}`) return send(401, { refused: 'the session is not valid; sign in again' })
    if (req.method === 'POST' && req.url === '/api/ops') { asked.push(body); return send(201, { op: OP, computer: body.computer ?? 'k1' }) }
    if (req.method === 'GET' && req.url === `/api/ops/${OP}/stream`) {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      stream = res
      return say({ started: true })
    }
    if (req.method === 'POST' && req.url === `/api/ops/${OP}/in`) {
      ins.push(body)
      send(200, { ok: true })
      if (code === 0 && made) listed.push(agentOf(made))
      say({ line: code === 0 ? MADE : 'an agent has a name and a system prompt' })
      say({ done: true, code })
      return stream.end()
    }
    if (req.method === 'GET' && req.url === '/api/agents') { lists.push(req.url); return send(200, { agents: listed, choices: {} }) }
    send(404, { error: 'no such route' })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, asked, ins, lists, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }) }
}

/* A home signed in at the host, holding the prompt file. */
const homeWithPrompt = (url) => {
  const home = homeAt(url)
  fs.writeFileSync(path.join(home, 'reviewer.md'), PROMPT)
  return home
}

const remoteLines = (err) => err.split('\n').filter((l) => l.startsWith('remote: '))
const lines = (out) => out.split('\n').filter((l) => l.trim())

test('agent new --here makes the agent by the same op with the same prompt as without it, then lays out ./<name>/: CLAUDE.md the prompt as written, the naming file (the id the host lists, the name, the host, when) readable by you alone and without the session; one line more, naming the folder', async () => {
  const runs = {}
  for (const here of [false, true]) {
    const host = await agentsHost(), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', ...(here ? ['--here'] : []), '--host', host.url])
      assert.equal(r.code, 0, r.err)
      const folder = path.join(home, 'reviewer')
      runs[here] = { asked: host.asked, ins: host.ins, err: r.err, out: r.out, lists: host.lists.length, folder: fs.existsSync(folder) }
      if (!here) continue
      assert.deepEqual(fs.readdirSync(folder).sort(), [NAMING, 'CLAUDE.md'])
      assert.equal(fs.readFileSync(path.join(folder, 'CLAUDE.md'), 'utf8'), PROMPT)
      const naming = JSON.parse(fs.readFileSync(path.join(folder, NAMING), 'utf8'))
      assert.deepEqual(Object.keys(naming).sort(), ['host', 'id', 'made', 'name'])
      assert.deepEqual([naming.id, naming.name, naming.host], [REVIEWER.id, 'reviewer', host.url])
      assert.ok(!Number.isNaN(Date.parse(naming.made)), naming.made)
      assert.equal(fs.statSync(path.join(folder, NAMING)).mode & 0o777, 0o600)
      for (const f of fs.readdirSync(folder)) assert.ok(!fs.readFileSync(path.join(folder, f), 'utf8').includes(SECRET), `${f} holds the session`)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
  const [without, withHere] = [runs[false], runs[true]]
  assert.deepEqual(withHere.asked, without.asked, 'the same op')
  assert.deepEqual(withHere.ins, without.ins, 'the same prompt')
  assert.deepEqual(without.ins, [{ prompt: PROMPT }])
  assert.deepEqual(remoteLines(withHere.err), [`remote: ${MADE}`])
  assert.equal(withHere.err, without.err)
  assert.deepEqual([without.folder, without.lists, lines(without.out)], [false, 0, []], 'without --here: no folder, no list asked, nothing more said')
  assert.equal(lines(withHere.out).length, 1, withHere.out)
  assert.match(withHere.out, /folder \.\/reviewer\/ · CLAUDE\.md its prompt/)
})

test('agent new --here refuses a ./<name> that is a file or a folder that is not empty, before asking the host anything and touching nothing; an empty folder is taken', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const folder = path.join(home, 'reviewer')
  const run = () => cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--host', host.url])
  try {
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'notes.md'), 'mine')
    const full = await run()
    assert.equal(full.code, 2, full.err)
    assert.match(full.err, /\.\/reviewer\/ is not empty/)
    assert.deepEqual(fs.readdirSync(folder), ['notes.md'])
    fs.rmSync(folder, { recursive: true })
    fs.writeFileSync(folder, 'a file')
    const file = await run()
    assert.equal(file.code, 2, file.err)
    assert.match(file.err, /\.\/reviewer\/ is not a folder/)
    assert.deepEqual([host.asked, host.lists], [[], []], 'the host was asked nothing')
    fs.rmSync(folder)
    fs.mkdirSync(folder)
    const empty = await run()
    assert.equal(empty.code, 0, empty.err)
    assert.deepEqual(fs.readdirSync(folder).sort(), [NAMING, 'CLAUDE.md'])
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here lays out nothing when the op fails, and says the agent was made without its folder when the host does not list it', async () => {
  for (const [opts, said] of [[{ code: 1 }, /remote: an agent has a name and a system prompt/], [{ made: null }, /agent reviewer was made, but the host does not list it: no folder laid out/]]) {
    const host = await agentsHost(opts), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--host', host.url])
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('agent new --here without --prompt is written wrongly, before asking the host anything', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const r = await cli(home, ['agent', 'new', 'reviewer', '--here', '--host', host.url])
    assert.equal(r.code, 2, r.err)
    assert.match(r.err, /--here lays out its prompt as CLAUDE\.md: --prompt <file>/)
    assert.deepEqual(host.asked, [])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('atelier agents lists every agent of the person, one line each: its name, primary or not, where it may be asked from, and the folder this machine holds for it, from beside the folder or inside it; never its prompt', async () => {
  const ALEX = { id: 'agent:1a2b3c', name: 'alex' }, SCOUT = { id: 'agent:4d5e6f', name: 'scout' }
  const host = await agentsHost({ agents: [agentOf(ALEX, { primary: true }), agentOf(REVIEWER, { exposures: ['Sam', 'example-co'] }), agentOf(SCOUT)] })
  const home = homeAt(host.url)
  const lay = (name, naming) => { fs.mkdirSync(path.join(home, name)); fs.writeFileSync(path.join(home, name, NAMING), JSON.stringify(naming)) }
  try {
    lay('reviewer', { ...REVIEWER, host: host.url, made: '2026-11-10T10:00:00.000Z' })
    lay('alex', { ...ALEX, host: 'http://elsewhere.example', made: '2026-11-10T10:00:00.000Z' })
    lay('scout', { id: 'agent:000000', name: 'scout', host: host.url, made: '2026-11-10T10:00:00.000Z' })
    const beside = await cli(home, ['agents', '--host', host.url])
    assert.equal(beside.code, 0, beside.err)
    assert.deepEqual(lines(beside.out), [
      '  alex       primary · asked from nowhere',
      '  reviewer   asked from Sam, example-co · folder ./reviewer/',
      '  scout      asked from nowhere',
    ])
    assert.ok(!beside.out.includes(RULES))
    const inside = await cli(home, ['agents', '--host', host.url], { cwd: path.join(home, 'reviewer') })
    assert.equal(inside.code, 0, inside.err)
    assert.equal(lines(inside.out)[1], '  reviewer   asked from Sam, example-co · folder here')
    assert.deepEqual(host.asked, [], 'no op: the list is the host\'s')
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('atelier agents says when there are none, and not signed in at the host is exit 3', async () => {
  const host = await agentsHost(), home = homeAt(host.url)
  try {
    const none = await cli(home, ['agents', '--host', host.url])
    assert.equal(none.code, 0, none.err)
    assert.deepEqual(lines(none.out), ['  no agents yet'])
    const other = await cli(home, ['agents', '--host', 'http://127.0.0.1:1'])
    assert.equal(other.code, 3, other.err)
    assert.match(other.err, /not signed in at http:\/\/127\.0\.0\.1:1/)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('inside a sandbox atelier agents and agent new --here are a machine\'s: refused with exit 1 before the socket or the host is asked, nothing laid out', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const env = { ATELIER_SOCKET: path.join(home, 'nowhere.sock'), ATELIER_SANDBOX: 'sandbox:3d9f04' }
  try {
    for (const [args, said] of [[['agents'], /inside a sandbox the agents are the fleet's: atelier agents is a machine's/],
      [['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here'], /inside a sandbox there is no folder of a machine: agent new --here is a machine's/]]) {
      const r = await cli(home, [...args, '--host', host.url], { env })
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.ok(!r.err.includes('socket'), r.err)
    }
    assert.deepEqual([host.asked, host.lists], [[], []])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
