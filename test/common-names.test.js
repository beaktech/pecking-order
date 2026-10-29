import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSqlite } from '../src/sqlite.js'
import { loadCommonNames } from '../src/common-names.js'
import { loadLibraryCache, saveLibraryCache, scanLibrary } from '../src/library.js'

const { DatabaseSync } = await loadSqlite()
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-names-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = { source: 'birdnet-go', archiveRoot: join(root, 'clips'), databasePath: join(root, 'birdnet.db'), sourceTimezone: 'UTC', dataRoot: join(root, 'data'), station: {} }
  await mkdir(config.archiveRoot)
  await writeFile(join(config.archiveRoot, 'parus_major_90p_20260515T120000Z.wav'), '')
  return config
}

test('Go legacy database supplies common names without modifying the database', async (t) => {
  const config = await fixture(t)
  const db = new DatabaseSync(config.databasePath)
  db.exec("CREATE TABLE notes (scientific_name TEXT, common_name TEXT); INSERT INTO notes VALUES ('Parus major', 'Old name'), ('Parus major', 'Great Tit')")
  db.close()
  const before = await readFile(config.databasePath)
  const library = await scanLibrary(config)
  assert.equal(library.clips[0].commonName, 'Great Tit')
  assert.deepEqual(await readFile(config.databasePath), before)
  assert.deepEqual(library.warnings, [])
})

test('Go v2 labels support stored combined names and scientific-only fallback', async (t) => {
  const config = await fixture(t)
  const db = new DatabaseSync(config.databasePath)
  db.exec("CREATE TABLE labels (scientific_name TEXT); INSERT INTO labels VALUES ('Parus major_Great Tit'), ('Turdus merula')")
  db.close()
  const { names } = await loadCommonNames(config)
  assert.equal(names.get('parus_major'), 'Great Tit')
  assert.equal(names.has('turdus_merula'), false)
})

test('absent or unreadable optional Go names fall back to bundled English names with a report', async (t) => {
  const config = await fixture(t)
  const library = await scanLibrary(config)
  assert.equal(library.clips[0].commonName, 'Great Tit')
  assert.equal(library.clips[0].scientificName, 'Parus major')
  assert.match(library.warnings[0].message, /optional BirdNET-Go/)
  await assert.rejects(readFile(config.databasePath), { code: 'ENOENT' })
  delete config.databasePath
  assert.deepEqual((await scanLibrary(config)).warnings, [])
})

test('explicit labels override native names and changes invalidate cached names without changing recording IDs', async (t) => {
  const config = await fixture(t)
  const db = new DatabaseSync(config.databasePath)
  db.exec("CREATE TABLE notes (scientific_name TEXT, common_name TEXT); INSERT INTO notes VALUES ('Parus major', 'Great Tit')")
  db.close()
  config.labelsPath = join(config.archiveRoot, 'labels.txt')
  await writeFile(config.labelsPath, 'Parus major_Mésange charbonnière\n')
  const first = await scanLibrary(config)
  assert.equal(first.clips[0].commonName, 'Mésange charbonnière')
  await saveLibraryCache(first, config)
  assert.equal((await loadLibraryCache(config)).clips[0].commonName, 'Mésange charbonnière')
  await writeFile(config.labelsPath, 'Parus major_Kohlmeise\n')
  assert.equal(await loadLibraryCache(config), null)
  const second = await scanLibrary(config)
  assert.equal(second.clips[0].id, first.clips[0].id)
  assert.equal(second.clips[0].commonName, 'Kohlmeise')
  delete config.labelsPath
  delete config.databasePath
  assert.equal((await scanLibrary(config)).clips[0].id, first.clips[0].id)
})

test('a missing explicitly selected label file is actionable', async (t) => {
  const config = await fixture(t)
  delete config.databasePath
  config.labelsPath = join(config.archiveRoot, 'missing-labels.txt')
  await assert.rejects(scanLibrary(config), (error) => error.message.includes(config.labelsPath) && /labelsPath/.test(error.message))
})

test('scientific-only Go databases get searchable English names without changing the database', async (t) => {
  const config = await fixture(t)
  const db = new DatabaseSync(config.databasePath)
  db.exec("CREATE TABLE labels (scientific_name TEXT); INSERT INTO labels VALUES ('Parus major')")
  db.close()
  const before = await readFile(config.databasePath)
  const library = await scanLibrary(config)
  assert.equal(library.summary().species[0].commonName, 'Great Tit')
  assert.deepEqual(library.warnings, [])
  assert.deepEqual(await readFile(config.databasePath), before)
  await saveLibraryCache(library, config)
  const cachePath = join(config.dataRoot, 'library-index.json')
  const oldCache = JSON.parse(await readFile(cachePath, 'utf8'))
  oldCache.schemaVersion = 4
  oldCache.clips[0].commonName = ''
  await writeFile(cachePath, JSON.stringify(oldCache))
  assert.equal(await loadLibraryCache(config), null)
  assert.equal((await scanLibrary(config)).clips[0].id, library.clips[0].id)
})

test('bundled names cover audio-only Go archives without inventing unknown names', async (t) => {
  const config = await fixture(t)
  delete config.databasePath
  await writeFile(join(config.archiveRoot, 'unknown_species_90p_20260515T120000Z.wav'), '')
  const library = await scanLibrary(config)
  assert.equal(library.clips.find(clip => clip.slug === 'parus_major').commonName, 'Great Tit')
  assert.equal(library.clips.find(clip => clip.slug === 'unknown_species').commonName, '')
  assert.deepEqual(library.warnings, [])
})

test('native Pi names take precedence over bundled English names, with explicit labels highest', async (t) => {
  const config = await fixture(t)
  config.source = 'birdnet-pi'
  const folder = join(config.archiveRoot, 'By_Date', '2026-05-15', 'Mesange')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'synthetic.wav'), '')
  const db = new DatabaseSync(config.databasePath)
  db.exec("CREATE TABLE detections (Date TEXT, Time TEXT, Sci_Name TEXT, Com_Name TEXT, Confidence REAL, File_Name TEXT)")
  db.prepare('INSERT INTO detections VALUES (?, ?, ?, ?, ?, ?)').run('2026-05-15', '12:00:00', 'Parus major', 'Mesange', 0.9, 'synthetic.wav')
  db.close()
  assert.equal((await scanLibrary(config)).clips[0].commonName, 'Mesange')
  config.labelsPath = join(config.archiveRoot, 'labels.txt')
  await writeFile(config.labelsPath, 'Parus major_Kohlmeise\n')
  assert.equal((await scanLibrary(config)).clips[0].commonName, 'Kohlmeise')
})
