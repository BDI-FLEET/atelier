// When the page cannot import a bundle, bundle-failure.js fetches the same address once and says why in words a person
// can act on: the host did not answer, answered an error, served a script the browser refused, or served something else.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { explainBundleFailure } from '../bundle-failure.js'

const URL_ = '/modules/global/skin/frontend.js'
const HOST = 'atelier.example'
const IMPORT_ERROR = new TypeError('Importing a module script failed.')
const answering = (status, type, statusText = '') => async () => new Response(null, { status, statusText, headers: type ? { 'content-type': type } : {} })
const explain = (fetchFn, what) => explainBundleFailure(URL_, IMPORT_ERROR, { host: HOST, what, fetchFn })

test('a fetch that throws is unreachable and names the address and the error', async () => {
  const { kind, words } = await explain(async () => { throw new TypeError('Load failed') })
  assert.equal(kind, 'unreachable')
  assert.match(words, /The host did not answer for \/modules\/global\/skin\/frontend\.js: Load failed\. Check the connection and reload\./)
})

test('a 401 is answered with the status and asks the person to sign in again', async () => {
  const { kind, words } = await explain(answering(401, 'text/html', 'Unauthorized'))
  assert.equal(kind, 'answered')
  assert.match(words, /The host answered 401 Unauthorized for \/modules\/global\/skin\/frontend\.js\./)
  assert.match(words, /Your session is not accepted\. Sign in again\./)
})

test('a 403 asks the person to sign in again like a 401', async () => {
  assert.match((await explain(answering(403, 'text/html'))).words, /Your session is not accepted\. Sign in again\./)
})

test('a 404 says the bundle is not installed on the host, naming what the bundle is', async () => {
  const chrome = await explain(answering(404, 'text/plain'))
  assert.equal(chrome.kind, 'answered')
  assert.match(chrome.words, /The host answered 404 for \/modules\/global\/skin\/frontend\.js\./)
  assert.match(chrome.words, /This chrome is not installed on the host\./)
  assert.match((await explain(answering(404, 'text/plain'), 'sign-in module')).words, /This sign-in module is not installed on the host\./)
})

test('a 5xx says the host is in trouble and to try again in a minute', async () => {
  const { kind, words } = await explain(answering(503, 'text/html', 'Service Unavailable'))
  assert.equal(kind, 'answered')
  assert.match(words, /The host answered 503 Service Unavailable for/)
  assert.match(words, /The host is in trouble\. Try again in a minute\./)
})

test('a status with no line of its own is said alone', async () => {
  const { words } = await explain(answering(429, 'text/plain'))
  assert.match(words, /^The host answered 429 for \/modules\/global\/skin\/frontend\.js\.\n/)
  assert.doesNotMatch(words, /Sign in again|not installed|in trouble/)
})

test('a script served but not run is blocked and names the host whose scripts to allow', async () => {
  const { kind, words } = await explain(answering(200, 'application/javascript; charset=utf-8'))
  assert.equal(kind, 'blocked')
  assert.match(words, /The host served the page's script, but your browser did not run it\./)
  assert.match(words, /A script blocker is on for atelier\.example \(Brave's Block scripts, NoScript or a similar extension\)\. Allow scripts for atelier\.example and reload\./)
})

test('anything else served is notScript and names the type it got', async () => {
  const html = await explain(answering(200, 'text/html; charset=utf-8'))
  assert.equal(html.kind, 'notScript')
  assert.match(html.words, /The host answered text\/html; charset=utf-8 instead of a script for \/modules\/global\/skin\/frontend\.js\./)
  assert.match((await explain(answering(200, null))).words, /The host answered no content type instead of a script for/)
})

test("every kind's words end with what the browser said about the import", async () => {
  const fetches = [async () => { throw new Error('offline') }, answering(401), answering(404), answering(502), answering(200, 'text/javascript'), answering(200, 'text/html')]
  for (const fetchFn of fetches) assert.match((await explain(fetchFn)).words, /\n\nThe browser said: Importing a module script failed\.$/)
})

test('the address is fetched once with the page credentials and no cache', async () => {
  const calls = []
  await explain(async (...args) => { calls.push(args); return new Response(null, { status: 200, headers: { 'content-type': 'text/javascript' } }) })
  assert.deepEqual(calls, [[URL_, { credentials: 'same-origin', cache: 'no-store' }]])
})
