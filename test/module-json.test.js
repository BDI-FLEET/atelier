// module-json.js: the declaration as the shell reads it beside a frontend's meta.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { declaredMeta } from '../module-json.js'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-module-json-'))
after(() => fs.rmSync(DIR, { recursive: true, force: true }))

test("module.json's sidebar fields come back as meta, and its problems are reported once per edit of the file, not on every read", () => {
  const file = path.join(DIR, 'module.json')
  fs.writeFileSync(file, JSON.stringify({ name: 'Notes', icon: 'pen', release: 'npm run migrate', colour: 'red' }))
  const warned = []
  const warn = console.warn
  console.warn = (line) => warned.push(line)
  try {
    assert.deepEqual(declaredMeta(DIR, 'global/notes').meta, { name: 'Notes', icon: 'pen' })
    declaredMeta(DIR, 'global/notes')
    assert.deepEqual(warned, ['  ! global/notes/module.json: unknown key "colour", ignored'])
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(file, later, later)
    declaredMeta(DIR, 'global/notes')
    assert.equal(warned.length, 2)
  } finally { console.warn = warn }
  assert.deepEqual(declaredMeta(path.join(DIR, 'none'), 'global/none'), { meta: {}, mtimeMs: 0 })
})
