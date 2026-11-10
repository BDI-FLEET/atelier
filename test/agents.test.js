// atelier agent new --here (agent.js) and atelier agents (agents.js), with the folder an agent has on this machine
// (agent-folder.js) — exercised through the real CLI against a fake of the host's op routes and GET /api/agents: the
// agent is made by the same op with the same prompt as without --here, its id is the one the host's list of the person's
// agents answers, and the folder holds the agent as Claude Code defines one (.claude/agents/<name>.md: front matter, then
// the prompt), the settings that start it there, and one file naming the agent, never the session.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { homeAt, cli } from './adopt-host.js'
import { SECRET } from './files-host.js'
import { AGENT_DESCRIPTION_CHARS } from '../limits.js'

const OP = 'op-5e6f7a8b'
const MADE = 'agent k1/main/reviewer · made · held by the fleet · it answers the chat once `agent primary reviewer` names it'
const PROMPT = '# reviewer\n\nYou read pull requests and say what breaks.\n'
const DESCRIPTION = 'Reads pull requests and says what breaks'
const RULES = 'the rules the fleet holds, never printed'
const REVIEWER = { id: 'agent:9b1c4e', name: 'reviewer' }
const NAMING = '.atelier-agent.json'
const definitionOf = (name) => `.claude/agents/${name}.md`
const SETTINGS = '.claude/settings.json'
const laidOut = (name) => [NAMING, definitionOf(name), SETTINGS].sort()

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
const homeWithPrompt = (url, prompt = PROMPT) => {
  const home = homeAt(url)
  fs.writeFileSync(path.join(home, 'reviewer.md'), prompt)
  return home
}

const remoteLines = (err) => err.split('\n').filter((l) => l.startsWith('remote: '))
const lines = (out) => out.split('\n').filter((l) => l.trim())

/* Every file under `dir`, by its path from there, sorted; folders only by the files they hold. */
const filesIn = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort()

const ESCAPES = { 0: '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: '\u2028', P: '\u2029' }
const NOT_A_STRING = /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|y|Y|yes|Yes|YES|n|N|no|No|NO|on|On|ON|off|Off|OFF|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/

/* One scalar of a `key: value` line as a YAML parser reads it: double-quoted with its escapes, single-quoted, or plain.
 * A plain one ends at a ` #` comment, holds no `: `, starts with no indicator, and is a string only when it is no null,
 * boolean or number of YAML 1.1 or 1.2; anything else is answered as { notAString } and fails the comparison. */
function scalar(raw) {
  if (raw.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"[ \t]*(?:#.*)?$/.exec(raw)
    assert.ok(m, `not one double-quoted scalar: ${raw}`)
    return m[1].replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|(.))/g, (_, x, u, U, c) => {
      const hex = x ?? u ?? U
      if (hex) return String.fromCodePoint(parseInt(hex, 16))
      assert.ok(c in ESCAPES, `\\${c} is no YAML escape`)
      return ESCAPES[c]
    })
  }
  if (raw.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/.exec(raw)
    assert.ok(m, `not one single-quoted scalar: ${raw}`)
    return m[1].replace(/''/g, "'")
  }
  const value = raw.replace(/[ \t]#.*$/, '').trim()
  if (!value || /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) || /:(?:[ \t]|$)/.test(value) || NOT_A_STRING.test(value)) return { notAString: raw }
  return value
}

/* A definition of Claude Code's read as it is split: its first line `---`, its front matter up to the next line `---` as
 * `key: value` lines, and its body, the bytes after that line. */
function definitionIn(file) {
  const bytes = fs.readFileSync(file)
  const text = bytes.toString('utf8')
  const all = text.split('\n')
  assert.equal(all[0], '---', 'the first line opens the front matter')
  const close = all.indexOf('---', 1)
  assert.ok(close > 0, 'the front matter is closed')
  const fields = {}
  for (const line of all.slice(1, close)) {
    const m = /^([A-Za-z]+):[ \t](.*)$/.exec(line)
    assert.ok(m, `not one key: value line: ${JSON.stringify(line)}`)
    assert.ok(!(m[1] in fields), `${m[1]} twice`)
    fields[m[1]] = scalar(m[2])
  }
  return { fields, body: bytes.subarray(Buffer.byteLength(all.slice(0, close + 1).join('\n') + '\n')) }
}

const newHere = (url, name = 'reviewer', more = []) => ['agent', 'new', name, '--prompt', 'reviewer.md', '--here', '--description', DESCRIPTION, ...more, '--host', url]

test('agent new --here makes the agent by the same op with the same prompt as without it, then lays out ./<name>/ as Claude Code\'s agent: .claude/agents/<name>.md its definition (front matter name and description, the prompt as written its body), .claude/settings.json starting it there, the naming file (the id the host lists, the name, the host, when) readable by you alone and without the session; one line more, saying how to start it', async () => {
  const runs = {}
  for (const here of [false, true]) {
    const host = await agentsHost(), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, here ? newHere(host.url) : ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--host', host.url])
      assert.equal(r.code, 0, r.err)
      const folder = path.join(home, 'reviewer')
      runs[here] = { asked: host.asked, ins: host.ins, err: r.err, out: r.out, lists: host.lists.length, folder: fs.existsSync(folder) }
      if (!here) continue
      assert.deepEqual(filesIn(folder), laidOut('reviewer'), 'no CLAUDE.md: the definition, the settings, the naming file')
      const { fields, body } = definitionIn(path.join(folder, definitionOf('reviewer')))
      assert.deepEqual(fields, { name: 'reviewer', description: DESCRIPTION })
      assert.deepEqual(body, Buffer.from(PROMPT))
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, SETTINGS), 'utf8')), { agent: 'reviewer' })
      const naming = JSON.parse(fs.readFileSync(path.join(folder, NAMING), 'utf8'))
      assert.deepEqual(Object.keys(naming).sort(), ['host', 'id', 'made', 'name'])
      assert.deepEqual([naming.id, naming.name, naming.host], [REVIEWER.id, 'reviewer', host.url])
      assert.ok(!Number.isNaN(Date.parse(naming.made)), naming.made)
      assert.equal(fs.statSync(path.join(folder, NAMING)).mode & 0o777, 0o600)
      for (const f of filesIn(folder)) assert.ok(!fs.readFileSync(path.join(folder, f), 'utf8').includes(SECRET), `${f} holds the session`)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
  const [without, withHere] = [runs[false], runs[true]]
  assert.deepEqual(withHere.asked, without.asked, 'the same op: the description is the folder\'s alone')
  assert.deepEqual(withHere.ins, without.ins, 'the same prompt')
  assert.deepEqual(without.ins, [{ prompt: PROMPT }])
  assert.deepEqual(remoteLines(withHere.err), [`remote: ${MADE}`])
  assert.equal(withHere.err, without.err)
  assert.deepEqual([without.folder, without.lists, lines(without.out)], [false, 0, []], 'without --here: no folder, no list asked, nothing more said')
  assert.deepEqual(lines(withHere.out), ['folder ./reviewer/ · .claude/agents/reviewer.md defines it · start it: cd reviewer && claude · or there: claude --agent reviewer'])
})

test('the definition\'s body is the prompt file byte for byte, also a prompt that holds front matter of its own and a line ---, and one that ends without a newline; a name YAML would read as no string (null, no) is still the name', async () => {
  const cases = [
    ['null', '---\nname: impostor\ndescription: not this one\n---\nYou review.\n---\nand one more line.\n'],
    ['no', 'You review, and the last line has no newline: ---'],
  ]
  for (const [name, prompt] of cases) {
    const host = await agentsHost({ made: { id: `agent:${name}`, name } }), home = homeWithPrompt(host.url, prompt)
    try {
      const r = await cli(home, newHere(host.url, name))
      assert.equal(r.code, 0, r.err)
      const folder = path.join(home, name)
      assert.deepEqual(filesIn(folder), laidOut(name))
      const { fields, body } = definitionIn(path.join(folder, definitionOf(name)))
      assert.deepEqual(fields, { name, description: DESCRIPTION })
      assert.deepEqual(body, fs.readFileSync(path.join(home, 'reviewer.md')))
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, SETTINGS), 'utf8')), { agent: name })
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('a description with a colon, quotes, a # and a backslash, and a model as written, read back by a YAML reading unchanged', async () => {
  const description = 'Reviews pull requests: says "what breaks" #1, it\'s a C:\\ path too'
  const model = 'claude-opus-4-1'
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const args = ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--description', description, '--model', model, '--host', host.url]
    const r = await cli(home, args)
    assert.equal(r.code, 0, r.err)
    const { fields, body } = definitionIn(path.join(home, 'reviewer', definitionOf('reviewer')))
    assert.deepEqual(fields, { name: 'reviewer', description, model })
    assert.deepEqual(body, Buffer.from(PROMPT))
    assert.deepEqual(host.ins, [{ prompt: PROMPT }], 'neither the description nor the model goes to the host')
    assert.ok(!JSON.stringify(host.asked).includes(model))
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here without --description, with one that is empty, more than one line, holds a control character, starts with a dash or is too long, or with a model of two lines, is written wrongly: exit 2 with the usage, before asking the host anything', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const base = ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here']
  const cases = [
    [[], /--here defines the agent for Claude Code, which skips a definition without one: --description "<one line>"/],
    [['--description', ''], /--description: one line of printable characters/],
    [['--description', '   '], /--description: one line of printable characters/],
    [['--description', 'two\nlines'], /--description: one line of printable characters/],
    [['--description', 'a bell\x07'], /--description: one line of printable characters/],
    [['--description', 'a line\u2028and another'], /--description: one line of printable characters/],
    [['--description', 'no character of YAML\ufffe'], /--description: one line of printable characters/],
    [['--description', 'no character of YAML\uffff'], /--description: one line of printable characters/],
    [['--description', 'a byte order mark\ufeff inside'], /--description: one line of printable characters/],
    [['--description', `x${'y'.repeat(AGENT_DESCRIPTION_CHARS)}`], new RegExp(`--description: one line of printable characters, at most ${AGENT_DESCRIPTION_CHARS}`)],
    [['--description', '-starts with a dash'], /--description needs <line>/],
    [['--description', DESCRIPTION, '--model', 'two\nlines'], /--model: one line of printable characters/],
  ]
  try {
    for (const [more, said] of cases) {
      const r = await cli(home, [...base, ...more, '--host', host.url])
      assert.equal(r.code, 2, `${JSON.stringify(more)}: ${r.err}`)
      assert.match(r.err, said)
      assert.match(r.err, /usage: atelier agent/)
    }
    assert.deepEqual([host.asked, host.lists], [[], []], 'the host was asked nothing')
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
    const longest = await cli(home, [...base, '--description', 'y'.repeat(AGENT_DESCRIPTION_CHARS), '--host', host.url])
    assert.equal(longest.code, 0, longest.err)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('--description and --model without --here are written wrongly, as they are written in the folder alone: exit 2, the host asked nothing', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    for (const more of [['--description', DESCRIPTION], ['--model', 'sonnet']]) {
      const r = await cli(home, ['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', ...more, '--host', host.url])
      assert.equal(r.code, 2, r.err)
      assert.match(r.err, new RegExp(`${more[0]} is written in the agent's folder alone: with --here`))
    }
    assert.deepEqual([host.asked, host.lists], [[], []])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here refuses a ./<name> that is a file or a folder that is not empty, before asking the host anything and touching nothing; an empty folder is taken', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  const folder = path.join(home, 'reviewer')
  const run = () => cli(home, newHere(host.url))
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
    assert.deepEqual(filesIn(folder), laidOut('reviewer'))
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('agent new --here lays out nothing when the op fails, and says the agent was made without its folder when the host does not list it', async () => {
  for (const [opts, said] of [[{ code: 1 }, /remote: an agent has a name and a system prompt/], [{ made: null }, /agent reviewer was made, but the host does not list it: no folder laid out/]]) {
    const host = await agentsHost(opts), home = homeWithPrompt(host.url)
    try {
      const r = await cli(home, newHere(host.url))
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
    } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
  }
})

test('agent new --here without --prompt is written wrongly, before asking the host anything', async () => {
  const host = await agentsHost(), home = homeWithPrompt(host.url)
  try {
    const r = await cli(home, ['agent', 'new', 'reviewer', '--here', '--description', DESCRIPTION, '--host', host.url])
    assert.equal(r.code, 2, r.err)
    assert.match(r.err, /--here writes its prompt as the body of \.claude\/agents\/reviewer\.md: --prompt <file>/)
    assert.deepEqual(host.asked, [])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})

test('atelier agents lists every agent of the person, one line each: its name, whether it is their 1:1\'s primary made askable, where it may be asked from, and the folder this machine holds for it (its id and host), from beside the folder or inside it; never its prompt', async () => {
  const ALEX = { id: 'agent:1a2b3c', name: 'Alex\'s Bayard' }, SCOUT = { id: 'agent:4d5e6f', name: 'scout' }, DRAFTER = { id: 'agent:7a8b9c', name: 'drafter' }
  const host = await agentsHost({ agents: [agentOf(ALEX, { primary: true }), agentOf(REVIEWER, { exposures: ['Sam', 'example-co'] }), agentOf(SCOUT), agentOf(DRAFTER)] })
  const home = homeAt(host.url)
  const lay = (name, naming) => { fs.mkdirSync(path.join(home, name)); fs.writeFileSync(path.join(home, name, NAMING), JSON.stringify(naming)) }
  try {
    lay('reviewer', { ...REVIEWER, host: host.url, made: '2026-11-10T10:00:00.000Z' })
    lay('scout', { ...SCOUT, host: 'http://elsewhere.example', made: '2026-11-10T10:00:00.000Z' })
    lay('drafter', { id: 'agent:000000', name: 'drafter', host: host.url, made: '2026-11-10T10:00:00.000Z' })
    const beside = await cli(home, ['agents', '--host', host.url])
    assert.equal(beside.code, 0, beside.err)
    assert.deepEqual(lines(beside.out), [
      '  Alex\'s Bayard   primary of your 1:1 · asked from nowhere',
      '  reviewer        asked from Sam, example-co · folder ./reviewer/',
      '  scout           asked from nowhere',
      '  drafter         asked from nowhere',
    ])
    assert.ok(!beside.out.includes(RULES))
    const inside = await cli(home, ['agents', '--host', host.url], { cwd: path.join(home, 'reviewer') })
    assert.equal(inside.code, 0, inside.err)
    assert.equal(lines(inside.out)[1], '  reviewer        asked from Sam, example-co · folder here')
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
      [['agent', 'new', 'reviewer', '--prompt', 'reviewer.md', '--here', '--description', DESCRIPTION], /inside a sandbox there is no folder of a machine: agent new --here is a machine's/]]) {
      const r = await cli(home, [...args, '--host', host.url], { env })
      assert.equal(r.code, 1, r.err)
      assert.match(r.err, said)
      assert.ok(!r.err.includes('socket'), r.err)
    }
    assert.deepEqual([host.asked, host.lists], [[], []])
    assert.equal(fs.existsSync(path.join(home, 'reviewer')), false)
  } finally { await host.close(); fs.rmSync(home, { recursive: true, force: true }) }
})
