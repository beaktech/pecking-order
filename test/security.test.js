import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServer } from '../src/server.js'
import { Store } from '../src/store.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-security-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new Store(root)
  let scans = 0
  const library = { get: id => id === 'clip' ? { id } : null, summary: () => ({ clipCount: 1 }) }
  const server = createAppServer({ config: {}, store, getLibrary: () => library, rescan: async () => { scans++; return library } })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  const port = server.address().port
  const base = `http://127.0.0.1:${port}`
  return { root, store, base, port, scans: () => scans }
}

test('rejects foreign origins, DNS-rebinding hosts and cross-site requests before side effects', async t => {
  const f = await fixture(t)
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'http://localhost:1' }]) {
    assert.equal((await fetch(`${f.base}/api/scan`, { method: 'POST', headers, body: '{}' })).status, 403)
  }
  const status = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.port, path: '/api/bootstrap', headers: { Host: `attacker.example:${f.port}` } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(status, 403)
  assert.equal(f.scans(), 0)
  assert.equal((await fetch(`${f.base}/api/scan`, { method: 'POST', headers: { Origin: f.base }, body: '{}' })).status, 200)
  assert.equal(f.scans(), 1)
})

test('accepts the documented localhost alias and returns protective response headers', async t => {
  const f = await fixture(t)
  const result = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: f.port, path: '/api/bootstrap', headers: { Host: `localhost:${f.port}`, Origin: `http://localhost:${f.port}` } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject); req.end()
  })
  assert.equal(result.status, 200)
  assert.equal(result.headers['x-frame-options'], 'DENY')
  assert.equal(result.headers['cross-origin-resource-policy'], 'same-origin')
})

test('rejects malformed, non-object, oversized and invalid review payloads without saving', async t => {
  const f = await fixture(t)
  for (const [body, status] of [
    ['{', 400], ['null', 400], ['[]', 400], ['true', 400], ['{"remarks":"' + 'x'.repeat(1024 * 1024) + '"}', 413],
    [JSON.stringify({ decision: '\"><img src=x onerror=alert(1)>' }), 400],
    [JSON.stringify({ confirmed: 'true' }), 400], [JSON.stringify({ location: {} }), 400],
    [JSON.stringify({ latitude: 91 }), 400], [JSON.stringify({ remarks: 'x'.repeat(4001) }), 400],
  ]) {
    const response = await fetch(`${f.base}/api/reviews/clip`, { method: 'PATCH', body })
    assert.equal(response.status, status)
    assert.ok((await response.json()).error)
    assert.deepEqual(f.store.reviews, {})
  }
  const valid = await fetch(`${f.base}/api/reviews/clip`, { method: 'PATCH', body: JSON.stringify({ decision: 'keep', confirmed: true, latitude: 0, longitude: '-1.5', remarks: 'A clear call' }) })
  assert.equal(valid.status, 200)
  assert.equal((await new Store(f.root).load()).reviews.clip.confirmed, true)
})
