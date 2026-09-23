// Text assets ship gzipped when the client accepts it: js/css/json over 1 KiB
// carry `Content-Encoding: gzip` + `Vary: Accept-Encoding` and decode to the
// same bytes; a client without `Accept-Encoding` gets the identity bytes; a
// matching ETag still answers 304 first.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'ws-gzip')

describe('gzip on text assets', () => {
  let server
  before(async () => { server = await startServer(FIXTURE) })
  after(async () => { await server?.stop() })

  const both = async (p) => {
    const plain = await fetch(server.base + p, { headers: { 'Accept-Encoding': 'identity' } })
    const gz = await fetch(server.base + p, { headers: { 'Accept-Encoding': 'gzip' } })
    assert.equal(plain.status, 200); assert.equal(gz.status, 200)
    return { plain, gz, plainText: await plain.text(), gzText: await gz.text() }
  }

  test('react vendor file: gzip when accepted, identity otherwise, same bytes', async () => {
    const { plain, gz, plainText, gzText } = await both('/assets/react.js')
    assert.equal(plain.headers.get('content-encoding'), null)
    assert.equal(gz.headers.get('content-encoding'), 'gzip')
    assert.equal(gz.headers.get('vary'), 'Accept-Encoding')
    assert.equal(gzText, plainText)
    assert.ok(Number(gz.headers.get('content-length')) < Number(plain.headers.get('content-length')) / 2, 'gzip is at least 2x smaller')
  })

  test('module frontend bundle: gzip when accepted', async () => {
    const { gz, plainText, gzText } = await both('/modules/global/big/frontend.js')
    assert.equal(gz.headers.get('content-encoding'), 'gzip')
    assert.equal(gzText, plainText)
  })

  test('a tiny asset is not compressed', async () => {
    const { plain, gz } = await both('/modules/global/tiny/frontend.js')
    assert.ok(Number(plain.headers.get('content-length')) < 1024, 'fixture is under 1 KiB')
    assert.equal(gz.headers.get('content-encoding'), null)
    assert.equal(gz.headers.get('vary'), null)
  })

  test('a matching ETag still answers 304 before any compression', async () => {
    const first = await fetch(server.base + '/assets/react.js', { headers: { 'Accept-Encoding': 'gzip' } })
    const etag = first.headers.get('etag')
    const second = await fetch(server.base + '/assets/react.js', { headers: { 'Accept-Encoding': 'gzip', 'If-None-Match': etag } })
    assert.equal(second.status, 304)
    assert.equal(second.headers.get('content-encoding'), null)
  })
})
