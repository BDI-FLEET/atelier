// With hot reload off (a deployed instance: its files do not change while it runs) built assets are addressed by a tag of
// their content and kept by the browser: the document's addresses carry `?v=<tag>`, so do the import map's and every
// relative import inside a built asset, and an asset asked with the tag answers `immutable`. With hot reload on nothing
// changes: `no-cache` and an ETag, as before.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'ws-kept')
const TAG = /^[0-9a-f]{12}$/

describe('built assets keep when hot reload is off', () => {
  let server, tag
  before(async () => {
    server = await startServer(FIXTURE, { ATELIER_HOT_RELOAD: 'false' })
    const html = await (await fetch(server.base + '/')).text()
    tag = JSON.parse(html.match(/window\.__ATELIER__ = (\{.*?\});/)[1]).assetTag
  })
  after(async () => { await server?.stop() })

  test('the document names its assets by the tag: the shell files, the import map, the bootstrap', async () => {
    assert.match(tag, TAG)
    const html = await (await fetch(server.base + '/')).text()
    for (const a of ['/assets/react.js', '/assets/react-dom.js', '/assets/client.js']) assert.ok(html.includes(`src="${a}?v=${tag}"`), a)
    assert.ok(html.includes(`"@atelier/kit":"/modules/global/skin/kit.js?v=${tag}"`), 'the import map carries the tag')
  })

  test('an asset asked with the tag is immutable and its relative imports carry the tag; the vendor files too', async () => {
    const client = await fetch(server.base + `/assets/client.js?v=${tag}`)
    assert.equal(client.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    const body = await client.text()
    assert.ok(body.includes(`./host-pages.js?v=${tag}`), 'client.js imports host-pages by the tag')
    assert.equal(/from\s*["']\.\/[^"'?]+["']/.test(body), false, 'no relative import left untagged')
    const alpha = await fetch(server.base + `/modules/global/alpha/frontend.js?v=${tag}`)
    assert.equal(alpha.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.ok((await alpha.text()).includes(`./helper.js?v=${tag}`))
    const react = await fetch(server.base + `/assets/react.js?v=${tag}`)
    assert.equal(react.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  })

  test('without the tag, or with another, an asset answers as before: no-cache and an ETag', async () => {
    for (const q of ['', '?v=0123456789ab']) {
      const r = await fetch(server.base + '/assets/client.js' + q)
      assert.equal(r.headers.get('cache-control'), 'no-cache', q || 'bare')
      assert.ok(r.headers.get('etag'))
    }
  })
})

describe('with hot reload on nothing keeps', () => {
  let server
  before(async () => { server = await startServer(FIXTURE) })
  after(async () => { await server?.stop() })

  test('no tag in the document or the bootstrap, no-cache on every asset', async () => {
    const html = await (await fetch(server.base + '/')).text()
    assert.equal(html.includes('?v='), false)
    assert.equal(JSON.parse(html.match(/window\.__ATELIER__ = (\{.*?\});/)[1]).assetTag, null)
    assert.equal((await fetch(server.base + '/assets/client.js?v=0123456789ab')).headers.get('cache-control'), 'no-cache')
  })
})
