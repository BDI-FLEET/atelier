// The keys a module's frame hands to its page: the frame (frame.jsx) sends them and the page (module-frame.jsx) takes
// them, the same keys on both sides, among them the chrome's two chords, so ⌘K and ⌘B pressed inside a module work as on the page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read } from './ours.js'

const keysOf = (src, who) => {
  const line = src.split('\n').find((l) => new RegExp(`${who}\\.key === '`).test(l))
  assert.ok(line, `${who} names its keys on one line`)
  return [...line.matchAll(new RegExp(`${who}\\.key === '([^']+)'`, 'g'))].map((m) => m[1]).sort()
}

test('the frame hands up exactly the keys the page takes, Escape and the chords k and b in both cases, so ⌘B collapses the sidebar from inside a module', () => {
  const handed = keysOf(read('frame.jsx'), 'e'), taken = keysOf(read('module-frame.jsx'), 'd')
  assert.deepEqual(taken, ['B', 'Escape', 'K', 'b', 'k'])
  assert.deepEqual(handed, taken.filter((k) => k !== 'Escape'))
  assert.match(read('frame.jsx'), /e\.key !== 'Escape'/)
})
