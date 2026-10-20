// Every wait, size and count of the hosted CLI, the backend processes and module-serve is one named constant in
// limits.js with its sentence: the files ours.js lists write none of the shapes a number of that kind takes, and a path
// or a header they share is written once.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILES, read, codeLines } from './ours.js'

const PLACE = 'limits.js'

const SHAPES = [
  ['a product of numbers', /\b\d[\d_]*\s*\*\s*\d/],
  ['a number grouped in thousands', /\b\d{1,3}(?:_\d{3})+\b/],
  ['a timer given a number', /\b(?:setTimeout|setInterval)\([^;]*,\s*\d+\s*\)/],
  ['a timeout given a number', /\btimeout\w*\s*[:=]\s*\d/i],
  ['a cut to a number of characters', /\.(?:slice|substring)\(\s*0\s*,\s*\d+\s*\)|\.pad(?:End|Start)\(\s*\d+\s*\)/],
  ['a step of a number', /[+-]=\s*\d{2,}\b/],
  ['an offset of a number', /[\w)\]]\s*[+-]\s*\d{2,}\b/],
  ['a length bound written in a pattern', /\{[01],\d+\}/],
  ['a length compared with a number', /\.length\s*[<>]=?\s*\d{2,}\b/],
  ['a number as a fallback', /(?<!statusCode\s*)\|\|\s*\d{2,}\b/],
  ['a number in a max or a min', /Math\.(?:max|min)\([^)]*\b\d{2,}\b/],
  ['a loop bound of a number', /\bfor\s*\([^;]*;[^;]*[<>]=?\s*[1-9]\d*\s*;/],
]
const PORT = ['a port in an address', /\/\/[\w.[\]:-]+:\d{2,5}\b/]

const SHARED = ["'/api/computers'", "'x-atelier-caller'", "'x-atelier-shell'", "'module.json'", "'backend.js'", "'frontend.jsx'", "'data.tar'"]

const withoutQuoted = (line) => line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")

test('the files of the hosted CLI write no wait, size or count as a number: each is a named constant read from limits.js', () => {
  const found = []
  for (const f of FILES) {
    for (const { line, at } of codeLines(f)) {
      const code = withoutQuoted(line)
      for (const [kind, shape] of SHAPES) if (shape.test(code)) found.push(`${f}:${at} ${kind}: ${line.trim()}`)
      if (PORT[1].test(line)) found.push(`${f}:${at} ${PORT[0]}: ${line.trim()}`)
    }
  }
  assert.deepEqual(found, [])
})

test('every constant of limits.js says in the comment above it what it bounds', () => {
  const lines = read(PLACE).split('\n')
  const bare = lines.flatMap((line, i) => /^export const /.test(line) && !/\*\/\s*$/.test(lines[i - 1] ?? '') ? [line] : [])
  assert.deepEqual(bare, [])
  assert.ok(lines.some((line) => /^export const /.test(line)))
})

test('a path or a header the files of the hosted CLI share is written once, where it is named', () => {
  const all = FILES.map(read).join('\n')
  const twice = SHARED.filter((s) => all.split(s).length - 1 !== 1)
  assert.deepEqual(twice, [])
})
