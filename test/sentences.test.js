// What every verb says for the same situation is one sentence, written once (session.js for the host's side, repo.js for
// the module folder's) and said from there: the words below stand once in the code of the hosted CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILES, codeLines } from './ours.js'

const SENTENCES = [
  ['not signed in', /not signed in at/],
  ['the host cannot be reached', /host at .* cannot be reached/],
  ['the grant is missing', /the grant is missing/],
  ['the host answered a status the verb did not expect', /answered \$\{/],
  ['not in a module folder', /not in a module folder/],
  ['no such remote', /not set: atelier remote/],
  ['git cannot set a remote', /could not set the remote/],
]

test('each sentence a verb says for a situation is written once in the CLI: not signed in, the host cannot be reached, the grant is missing, no module folder, no such remote', () => {
  const lines = FILES.flatMap((f) => codeLines(f).map(({ line, at }) => ({ line, where: `${f}:${at}` })))
  const said = Object.fromEntries(SENTENCES.map(([rule, words]) => [rule, lines.filter(({ line }) => words.test(line)).map(({ where }) => where)]))
  assert.deepEqual(Object.entries(said).filter(([, where]) => where.length !== 1), [])
})
