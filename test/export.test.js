import test from 'node:test'
import assert from 'node:assert/strict'
import { localDateTime, toCsv } from '../src/export.js'

test('converts UTC recording time to British Summer Time', () => {
  assert.deepEqual(localDateTime('2026-05-15T10:09:06.000Z', 'Europe/London'), {
    date: '2026-05-15', time: '11:09',
  })
})

test('quotes CSV values safely', () => {
  assert.equal(toCsv([{ name: 'Wren, Eurasian', remarks: 'A "clear" call' }]),
    '"name","remarks"\n"Wren, Eurasian","A ""clear"" call"\n')
})

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportSelections } from '../src/export.js'

const execFileAsync = promisify(execFile)

test('exports same-minute recordings separately, deduplicates ids, and isolates simultaneous exports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-export-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.wav')
  await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.05', source])
  const clips = ['abc', 'def'].map((id, index) => ({
    id, slug: 'turdus_merula', scientificName: 'Turdus merula',
    timestamp: `2026-05-15T10:09:0${index}Z`, path: source, confidence: 90,
  }))
  const library = { get: (id) => clips.find((clip) => clip.id === id), station: () => ({ name: 'Garden' }) }
  const store = { reviews: Object.fromEntries(clips.map(({ id }) => [id, { decision: 'keep', confirmed: true }])), metrics: {} }
  const options = { ids: ['abc', 'def', 'abc'], library, store, config: { exportRoot: join(root, 'exports'), timezone: 'Europe/London', country: 'United Kingdom' } }
  const [first, second] = await Promise.all([exportSelections(options), exportSelections(options)])
  assert.notEqual(first.outputDir, second.outputDir)
  for (const result of [first, second]) {
    assert.equal(result.count, 2)
    const files = (await readdir(result.outputDir)).filter((file) => file.endsWith('.wav'))
    assert.equal(files.length, 2)
    const manifest = await readFile(join(result.outputDir, 'xeno-canto-metadata.csv'), 'utf8')
    for (const file of files) assert.ok(manifest.includes(file))
  }
})

test('does not silently omit recordings missing from the index', async () => {
  await assert.rejects(exportSelections({ ids: ['missing'], library: { get: () => null } }), /no longer indexed/)
})

test('requires manual confirmation before exporting', async () => {
  await assert.rejects(exportSelections({
    ids: ['abc'], library: { get: () => ({ id: 'abc' }) }, store: { reviews: { abc: { decision: 'keep' } } },
  }), /identification confirmed/)
})

test('a failed conversion leaves no partial export and preserves earlier exports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-export-failure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.wav')
  await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.05', source])
  const clips = ['ok', 'missing'].map((id) => ({ id, slug: 'turdus_merula', scientificName: 'Turdus merula', timestamp: '2026-05-15T10:00:00Z', path: id === 'ok' ? source : join(root, 'missing.wav') }))
  const library = { get: (id) => clips.find(c => c.id === id), station: () => ({}) }
  const store = { reviews: Object.fromEntries(clips.map(c => [c.id, { decision: 'keep', confirmed: true }])), metrics: {} }
  const config = { exportRoot: join(root, 'exports'), timezone: 'Europe/London' }
  const saved = await exportSelections({ ids: ['ok'], library, store, config })
  await assert.rejects(exportSelections({ ids: ['ok', 'missing'], library, store, config }), /missing.wav/)
  assert.equal((await readdir(config.exportRoot)).length, 1)
  assert.ok((await readdir(saved.outputDir)).includes('xeno-canto-metadata.csv'))
})

test('validates the selection list instead of treating a string as recording IDs', async () => {
  await assert.rejects(exportSelections({ ids: 'abc' }), /recording IDs/)
})

test('uses the confirmed review captured at export start even if another tab edits it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-export-review-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source.wav')
  await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.05', source])
  const clips = ['first', 'second'].map(id => ({ id, slug: 'turdus_merula', scientificName: 'Turdus merula', timestamp: '2026-05-15T10:00:00Z', path: source }))
  const store = { metrics: {}, reviews: Object.fromEntries(clips.map(clip => [clip.id, { decision: 'keep', confirmed: true, remarks: 'Original review' }])) }
  const library = {
    get: id => clips.find(clip => clip.id === id),
    station: () => { store.reviews.second.remarks = 'Edited during export'; return {} },
  }
  const result = await exportSelections({ ids: ['first', 'second'], library, store, config: { exportRoot: join(root, 'exports'), timezone: 'Europe/London' } })
  const csv = await readFile(join(result.outputDir, 'xeno-canto-metadata.csv'), 'utf8')
  assert.equal(store.reviews.second.remarks, 'Edited during export')
  assert.equal(csv.includes('Edited during export'), false)
  assert.equal(csv.match(/Original review/g).length, 2)
})


test('CSV neutralises spreadsheet formulas while preserving signed numeric metadata', () => {
  for (const value of ['=1+1', '+SUM(1,2)', '-SUM(1,2)', '@SUM(1,2)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1']) {
    assert.equal(toCsv([{ remarks: value }]), `"remarks"\n"'${value}"\n`)
  }
  for (const value of [-1.5, '-1.5', '+12', '-1e-3', 0, 'Great Tit', 'A "clear", close call']) {
    assert.equal(toCsv([{ value }]), `"value"\n"${String(value).replaceAll('"', '""')}"\n`)
  }
})
