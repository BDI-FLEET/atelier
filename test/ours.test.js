// Every file of ours has a test: each file ours.js lists, and limits.js, is named by at least one test file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, FILES, LIMITS, read } from './ours.js'

const SELF = path.basename(fileURLToPath(import.meta.url))
const named = (file, text) => new RegExp(`(?:^|[^\\w-])${file.replace(/\./g, '\\.')}(?!\\w)`).test(text)

test('every file of ours is named by at least one test file', () => {
  const tests = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js') && f !== SELF).map((f) => read(path.join('test', f)))
  const unnamed = [...FILES, LIMITS].filter((file) => !tests.some((text) => named(file, text)))
  assert.deepEqual(unnamed, [], `no test file names ${unnamed.join(', ')}`)
})
