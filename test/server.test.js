import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppServer, parseByteRange } from '../src/server.js'
import { revealFile } from '../src/platform.js'

test('reveal API keeps an unavailable desktop path copyable and rejects unknown recordings', async (t) => {
  const path = '/Bird songs/clip.wav'
  const server = createAppServer({
    config: {}, store: {}, getLibrary: () => ({ get: (id) => id === 'clip' ? { path } : undefined }),
    reveal: (value) => revealFile(value, { platform: 'linux', env: {}, inspect: async () => {} }),
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/api/reveal/clip`, { method: 'POST' })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.path, path)
  assert.equal(result.opened, false)
  assert.match(result.message, /Copy/)
  assert.equal((await fetch(`${base}/api/reveal/missing`, { method: 'POST' })).status, 404)
})

for (const [range, expected] of [
  ['bytes=0-1', { start: 0, end: 1 }],
  ['bytes=5-', { start: 5, end: 9 }],
  ['bytes=-3', { start: 7, end: 9 }],
  ['bytes=-30', { start: 0, end: 9 }],
  ['bytes=5-100', { start: 5, end: 9 }],
  ['bytes=10-', null], ['bytes=-0', null], ['bytes=-', null],
  ['bytes=0-1,5-6', null], ['bytes=1.5-4', null], ['garbage', null],
]) {
  test(`audio range ${range}`, () => assert.deepEqual(parseByteRange(range, 10), expected))
}

test('a missing archive clip returns an error without crashing the server', async (t) => {
  const server = createAppServer({
    config: {}, store: { reviews: {} },
    getLibrary: () => ({ get: () => ({ path: '/nonexistent-pecking-order-test/clip.wav' }), summary: () => ({ clipCount: 1 }) }),
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const missing = await fetch(`${base}/media/abc`)
  assert.equal(missing.status, 500)
  assert.match((await missing.json()).error, /ENOENT/)
  const response = await fetch(`${base}/api/bootstrap`)
  assert.equal(response.status, 200)
})

test('bootstrap excludes reviews belonging to a different source archive', async (t) => {
  const server = createAppServer({
    config: {}, store: { reviews: { current: { decision: 'keep' }, previous: { decision: 'keep' } } },
    getLibrary: () => ({ get: (id) => id === 'current' ? { id } : null, summary: () => ({ clipCount: 1 }) }),
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const result = await (await fetch(`http://127.0.0.1:${server.address().port}/api/bootstrap`)).json()
  assert.deepEqual(result.reviews, { current: { decision: 'keep' } })
})
