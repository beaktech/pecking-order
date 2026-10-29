import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { saveLibraryCache } from '../src/library.js'
import { createAppServer } from '../src/server.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-cache-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  t.after(() => new Promise(resolve => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

test('simultaneous index saves publish complete JSON without temporary-file collisions', async t => {
  const root = await fixture(t)
  const config = { dataRoot: root, source: 'birdnet-go', archiveRoot: root, sourceTimezone: 'UTC' }
  const library = { clips: [{ id: 'clip', relPath: 'clip.wav' }], warnings: [] }
  await Promise.all(Array.from({ length: 8 }, () => saveLibraryCache(library, config)))
  assert.equal(JSON.parse(await readFile(join(root, 'library-index.json'), 'utf8')).clips[0].id, 'clip')
  assert.deepEqual(await readdir(root), ['library-index.json'])
})

test('overlapping rescans share work and a failed rescan can be retried', async t => {
  let calls = 0, release
  let gate = new Promise(resolve => { release = resolve })
  const server = createAppServer({ config: {}, rescan: async () => { calls++; await gate; return { summary: () => ({ clipCount: 1 }) } } })
  const base = await listen(t, server)
  const scan = () => fetch(`${base}/api/scan`, { method: 'POST' })
  const first = scan()
  const second = scan()
  // Wait for both requests to enter the server while the shared scan is blocked.
  await new Promise(resolve => {
    let received = 0
    const onRequest = () => { if (++received === 2) { server.off('request', onRequest); resolve() } }
    server.on('request', onRequest)
  })
  assert.equal(calls, 1)
  release()
  assert.deepEqual((await Promise.all([first, second])).map(r => r.status), [200, 200])
  gate = Promise.reject(new Error('Synthetic scan failure'))
  gate.catch(() => {})
  assert.equal((await scan()).status, 500)
  gate = Promise.resolve()
  assert.equal((await scan()).status, 200)
  assert.equal(calls, 3)
})

test('concurrent spectrogram requests receive complete PNGs and failed generation leaves no cache file', async t => {
  const root = await fixture(t)
  const path = join(root, 'source.wav')
  const clip = { id: 'clip', path }
  const server = createAppServer({ config: { dataRoot: root }, getLibrary: () => ({ get: () => clip }) })
  const base = await listen(t, server)
  assert.equal((await fetch(`${base}/spectrogram/clip`)).status, 500)
  assert.deepEqual(await readdir(join(root, 'spectrograms')), [])
  await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', path])
  const images = await Promise.all(Array.from({ length: 8 }, async () => {
    const response = await fetch(`${base}/spectrogram/clip`)
    assert.equal(response.status, 200)
    return Buffer.from(await response.arrayBuffer())
  }))
  assert.deepEqual(images[0].subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  assert.equal(images[0].subarray(-8, -4).toString(), 'IEND')
  for (const image of images) assert.deepEqual(image, images[0])
  assert.deepEqual(await readdir(join(root, 'spectrograms')), ['clip-magma.png'])
})
