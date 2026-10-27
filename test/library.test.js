import test from 'node:test'
import assert from 'node:assert/strict'
import { BirdLibrary, commonNameFor, parseClipFilename, spreadAcrossTime, zonedTime } from '../src/library.js'

test('parses BirdNET clip filenames', () => {
  assert.deepEqual(parseClipFilename('/clips/2026/05/fringilla_coelebs_83p_20260515T100906Z.flac'), {
    slug: 'fringilla_coelebs',
    scientificName: 'Fringilla coelebs',
    confidence: 83,
    timestamp: '2026-05-15T10:09:06.000Z',
    extension: 'flac',
  })
})

test('allows subspecies and hyphens in filenames', () => {
  const parsed = parseClipFilename('larus_fuscus_graellsii_100p_20260102T030405Z.wav')
  assert.equal(parsed.scientificName, 'Larus fuscus graellsii')
  assert.equal(parsed.confidence, 100)
})

test('rejects unrelated files', () => {
  assert.equal(parseClipFilename('.DS_Store'), null)
  assert.equal(parseClipFilename('spectrogram.png'), null)
})

test('spreads adjacent detections before filling remaining places', () => {
  const clips = [
    { id: 'a', timestamp: '2026-05-15T10:00:00Z' },
    { id: 'b', timestamp: '2026-05-15T10:00:30Z' },
    { id: 'c', timestamp: '2026-05-15T11:00:00Z' },
  ]
  assert.deepEqual(spreadAcrossTime(clips, 2).map(({ id }) => id), ['a', 'c'])
  assert.deepEqual(spreadAcrossTime(clips, 3).map(({ id }) => id), ['a', 'c', 'b'])
})

test('resolves common names for slugs whose taxonomy differs from the label file', () => {
  const labels = new Map([['corvus_monedula', 'Eurasian Jackdaw']])
  assert.equal(commonNameFor(labels, 'coloeus_monedula'), 'Eurasian Jackdaw')
  assert.equal(commonNameFor(labels, 'corvus_monedula'), 'Eurasian Jackdaw')
  assert.equal(commonNameFor(labels, 'turdus_merula'), '')
})

function libraryWith(timestamps, timezone = 'Europe/London') {
  const clips = timestamps.map((timestamp, index) => ({
    id: `c${index}`, slug: 'turdus_merula', confidence: 90, timestamp,
  }))
  const config = { timezone, station: { name: 'One' } }
  return new BirdLibrary(clips, config)
}

test('date filters follow the configured timezone, not UTC', () => {
  // Both clips fall on 15 May in UTC terms at the boundary, but the UI shows
  // Europe/London times: 23:30Z on the 14th IS 00:30 on the 15th locally.
  const library = libraryWith(['2026-05-14T23:30:00Z', '2026-05-15T23:30:00Z'])
  const found = library.findCandidates({ species: 'turdus_merula', from: '2026-05-15', to: '2026-05-15' })
  assert.deepEqual(found.map((clip) => clip.timestamp), ['2026-05-14T23:30:00Z'])
})

test('includes the whole of the final local day', () => {
  const library = libraryWith(['2026-05-15T22:59:59Z'])   // 23:59:59 BST on the 15th
  const found = library.findCandidates({ species: 'turdus_merula', from: '2026-05-15', to: '2026-05-15' })
  assert.equal(found.length, 1)
})

test('is unchanged outside daylight saving time', () => {
  const library = libraryWith(['2026-01-15T00:30:00Z', '2026-01-14T23:30:00Z'])
  const found = library.findCandidates({ species: 'turdus_merula', from: '2026-01-15', to: '2026-01-15' })
  assert.deepEqual(found.map((clip) => clip.timestamp), ['2026-01-15T00:30:00Z'])
})

test('a UTC-configured archive keeps UTC day boundaries', () => {
  const library = libraryWith(['2026-05-14T23:30:00Z', '2026-05-15T00:30:00Z'], 'UTC')
  const found = library.findCandidates({ species: 'turdus_merula', from: '2026-05-15', to: '2026-05-15' })
  assert.deepEqual(found.map((clip) => clip.timestamp), ['2026-05-15T00:30:00Z'])
})

test('handles the short and long days at daylight-saving transitions', () => {
  const dayLength = (date) => {
    const start = zonedTime(date, '00:00:00.000', 'Europe/London')
    const end = zonedTime(date, '23:59:59.999', 'Europe/London')
    return Math.round((end - start + 1) / 3_600_000)
  }
  assert.equal(dayLength('2026-03-29'), 23, 'clocks go forward, so the day is 23 hours')
  assert.equal(dayLength('2026-10-25'), 25, 'clocks go back, so the day is 25 hours')
  assert.equal(dayLength('2026-05-15'), 24)
})

test('excludes midnight of the following local day', () => {
  const library = libraryWith(['2026-05-15T22:59:59.999Z', '2026-05-15T23:00:00.000Z'])
  const found = library.findCandidates({ species: 'turdus_merula', from: '2026-05-15', to: '2026-05-15' })
  assert.deepEqual(found.map((clip) => clip.timestamp), ['2026-05-15T22:59:59.999Z'])
  assert.equal(new Date(zonedTime('2026-05-15', '23:59:59.999', 'Europe/London')).toISOString(), '2026-05-15T22:59:59.999Z')
})

import { scanLibrary } from '../src/library.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('an unavailable archive fails a rescan instead of returning an empty index', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-offline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(scanLibrary({ archiveRoot: join(root, 'unmounted'), source: 'birdnet-go' }), /recording archive is unavailable/)
})
