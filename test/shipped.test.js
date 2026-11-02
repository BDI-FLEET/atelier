// What the published shell carries: every file a page loads, followed from the two documents' scripts (client.jsx for
// the shell's page, frame.jsx for a module's frame) the way the document's preload tags follow them, and every file the
// shell names beside itself, is in package.json's files; a file left out answers 404 from an installed shell.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { staticImports } from '../build.js'
import { ROOT, read } from './ours.js'

const SCRIPTS = [['/assets/client.js', 'client.jsx'], ['/_frame/frame.js', 'frame.jsx']]
const NAMED_BESIDE = /path\.join\((?:HOST_DIR|hostDir),\s*'([^']+)'/g
const ALWAYS_SHIPPED = ['package.json']
const FILES = JSON.parse(read('package.json')).files
const shipped = (rel) => ALWAYS_SHIPPED.includes(rel) || FILES.some((entry) => rel === entry || rel.startsWith(entry + '/'))

test('every file the page imports from client.jsx and frame.jsx, and every file the shell names beside itself, is in package.json files', async () => {
  const loaded = (await Promise.all(SCRIPTS.map(([url, file]) => staticImports(url, path.join(ROOT, file))))).flat().filter((i) => i.file).map((i) => path.relative(ROOT, i.file))
  const named = fs.readdirSync(ROOT).filter((f) => /\.jsx?$/.test(f)).flatMap((f) => [...read(f).matchAll(NAMED_BESIDE)].map((m) => m[1]))
  assert.ok(loaded.includes('host-pages.jsx') && loaded.includes('ws-bridge.js') && named.includes('index.html'))
  assert.deepEqual([...new Set([...loaded, ...named])].filter((f) => !shipped(f)), [])
})
