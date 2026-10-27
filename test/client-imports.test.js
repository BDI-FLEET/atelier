// The page's script and the files beside it (module-frame.jsx, user-modules.js, host-pages.jsx, ws-bridge.js, chrome-resolve.js): the
// browser loads each one by one, so a name client.jsx asks for that its file does not export only fails in a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, read } from './ours.js'

const sourceOf = (served) => [served.replace(/\.js$/, '.jsx'), served].find((f) => fs.existsSync(path.join(ROOT, f)))

test('every name the page script imports from a file beside it is exported by that file', () => {
  const missing = []
  for (const [, names, served] of read('client.jsx').matchAll(/^import \{([^}]+)\} from '\.\/([^']+)';$/gm)) {
    const file = sourceOf(served)
    const exported = new Set([...read(file).matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]))
    for (const name of names.split(',').map((n) => n.trim())) if (!exported.has(name)) missing.push(`${file}: ${name}`)
  }
  assert.deepEqual(missing, [])
})
