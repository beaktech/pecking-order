import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadLibraryCache, parseClipFilename, saveLibraryCache, scanLibrary } from '../src/library.js'
import { readPiDatabase } from '../src/sources.js'
import { loadSqlite } from '../src/sqlite.js'
import { recordingTimestamp } from '../src/time.js'

const { DatabaseSync } = await loadSqlite()
const goFilename = 'parus_major_72p_20260515T120000Z_15s.wav'
const nativePi = { skip: process.platform === 'win32' && 'Native BirdNET-Pi filenames contain colons; use WSL. Covered on Linux/macOS.' }
const piFilename = 'Great_Tit-72-2026-05-15-birdnet-12:00:00.wav'
// Synthetic records follow Nachtzuster 88985a3 and mcguirepr89 a2febea's
// detections schema and filename generation; no real station data is used.
const piRow = { Date: '2026-05-15', Time: '12:00:00', Sci_Name: 'Parus major', Com_Name: 'Great Tit', Confidence: 0.72, File_Name: piFilename }

async function fixture(t, source = 'birdnet-go') {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = {
    projectRoot: root, dataRoot: join(root, 'data'), archiveRoot: join(root, 'recordings with spaces'),
    source, sourceTimezone: 'Europe/London', timezone: 'Europe/London', station: { name: 'Garden' },
  }
  await mkdir(config.archiveRoot)
  if (source === 'birdnet-pi') {
    config.databasePath = join(root, 'birds.db')
    await mkdir(join(config.archiveRoot, 'By_Date'))
  }
  return config
}

async function recording(path) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, 'synthetic index fixture; no audio decoding required')
  return path
}

function database(config, rows = [piRow]) {
  const db = new DatabaseSync(config.databasePath)
  try {
    db.exec('CREATE TABLE detections (Date DATE, Time TIME, Sci_Name TEXT NOT NULL, Com_Name TEXT NOT NULL, Confidence FLOAT, Lat FLOAT, Lon FLOAT, Cutoff FLOAT, Week INT, Sens FLOAT, Overlap FLOAT, File_Name TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO detections (Date, Time, Sci_Name, Com_Name, Confidence, File_Name) VALUES (?, ?, ?, ?, ?, ?)')
    for (const row of rows) insert.run(row.Date, row.Time, row.Sci_Name, row.Com_Name, row.Confidence, row.File_Name)
  } finally { db.close() }
}

function piPath(config, row = piRow) {
  return join(config.archiveRoot, 'By_Date', row.Date, row.Com_Name.replaceAll("'", '').replaceAll(' ', '_'), row.File_Name)
}

test('parses every BirdNET-Go export extension, with and without duration suffixes', () => {
  for (const ext of ['wav', 'flac', 'mp3', 'm4a', 'opus', 'ogg']) {
    for (const duration of ['', '_15s', '_312s']) {
      const clip = parseClipFilename(`strix_uralensis_85p_20260115T120000Z${duration}.${ext}`)
      assert.equal(clip.slug, 'strix_uralensis')
      assert.equal(clip.confidence, 85)
      assert.equal(clip.timestamp, '2026-01-15T12:00:00.000Z')
      assert.equal(clip.extension, ext)
    }
  }
  assert.equal(parseClipFilename('parus_major_101p_20260115T120000Z.wav'), null)
  assert.equal(parseClipFilename('parus_major_72p_20260115T120000Z_bad.wav'), null)
})

test('BirdNET-Go uses the station time zone even when the filename has a literal Z', () => {
  assert.equal(parseClipFilename(goFilename, 'Europe/London').timestamp, '2026-05-15T11:00:00.000Z')
  assert.equal(parseClipFilename(goFilename, 'UTC').timestamp, '2026-05-15T12:00:00.000Z')
})

test('recording timestamps handle day boundaries and half-hour time zones', () => {
  assert.equal(recordingTimestamp('2026-05-15', '00:15:00', 'Asia/Kolkata'), '2026-05-14T18:45:00.000Z')
  assert.equal(recordingTimestamp('2026-01-15', '23:15:00', 'America/New_York'), '2026-01-16T04:15:00.000Z')
})

test('invalid, nonexistent and repeated local timestamps are never guessed', () => {
  assert.throws(() => recordingTimestamp('2026-02-30', '12:00:00', 'UTC'), /Invalid recording/)
  assert.throws(() => recordingTimestamp('2026-03-29', '01:30:00', 'Europe/London'), /Nonexistent/)
  assert.throws(() => recordingTimestamp('2026-10-25', '01:30:00', 'Europe/London'), /Ambiguous/)
  assert.equal(recordingTimestamp('2026-10-25', '02:30:00', 'Europe/London'), '2026-10-25T02:30:00.000Z')
})

test('direct BirdNET-Go folders scan recursively and survive a cache round trip without changing recordings', async (t) => {
  const config = await fixture(t)
  const path = await recording(join(config.archiveRoot, '2026', '05', goFilename))
  await recording(join(config.archiveRoot, '2026', '02', 'turdus_merula_90p_20260201T120000Z.opus'))
  const before = await readFile(path)
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 2)
  assert.equal(library.summary().station.name, 'Garden')
  assert.equal(library.summary().monitors, undefined)
  await saveLibraryCache(library, config)
  const cached = await loadLibraryCache(config)
  assert.deepEqual(cached.clips, library.clips)
  assert.deepEqual(cached.summary(), library.summary())
  assert.deepEqual(await readFile(path), before)
})

test('Pi imports exact filenames and native scientific/common names; the database stays unchanged', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config)
  const path = await recording(piPath(config))
  const before = await readFile(config.databasePath)
  const beforeStat = await stat(config.databasePath)
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 1)
  const clip = library.clips[0]
  assert.equal(clip.path, path)
  assert.equal(clip.scientificName, 'Parus major')
  assert.equal(clip.commonName, 'Great Tit')
  assert.equal(clip.timestamp, '2026-05-15T11:00:00.000Z')
  assert.equal(clip.confidence, 72)
  await saveLibraryCache(library, config)
  assert.deepEqual((await loadLibraryCache(config)).clips, library.clips)
  assert.deepEqual(await readFile(config.databasePath), before)
  assert.equal((await stat(config.databasePath)).mtimeMs, beforeStat.mtimeMs)
})

test('Pi accepts its By_Date folder directly and preserves names with apostrophes and RTSP filenames', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  const row = { ...piRow, Com_Name: "Cetti's Warbler", Sci_Name: 'Cettia cetti', File_Name: 'Cettis_Warbler-72-2026-05-15-birdnet-RTSP_2-12:00:00.flac' }
  database(config, [row])
  await recording(piPath(config, row))
  config.archiveRoot = join(config.archiveRoot, 'By_Date')
  const library = await scanLibrary(config)
  assert.equal(library.clips[0].commonName, "Cetti's Warbler")
  assert.equal(library.clips[0].extension, 'flac')
})

test('original BirdNET-Pi filenames and its stored apostrophe-free common names are supported', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  const row = { ...piRow, Com_Name: 'Cettis Warbler', Sci_Name: 'Cettia cetti', File_Name: 'Cettis_Warbler-72-2026-05-15-birdnet-12:00:00.mp3' }
  database(config, [row])
  await recording(piPath(config, row))
  assert.equal((await scanLibrary(config)).clips[0].scientificName, 'Cettia cetti')
})

test('duplicate database references produce one recording, retaining the strongest confidence', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config, [piRow, piRow, { ...piRow, Confidence: 0.724 }])
  await recording(piPath(config))
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 1)
  assert.ok(Math.abs(library.clips[0].confidence - 72.4) < 0.000001)
})

test('conflicting species for one filename are reported, not inferred from the common name', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config, [piRow, { ...piRow, Sci_Name: 'Other species' }])
  await recording(piPath(config))
  await assert.rejects(scanLibrary(config), /Conflicting database identifications/)
})

test('unmatched audio, missing audio and invalid rows are reported alongside usable recordings', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config, [piRow, { ...piRow, File_Name: 'deleted.wav' }, { ...piRow, File_Name: '../outside.wav' }])
  await recording(piPath(config))
  await recording(join(config.archiveRoot, 'By_Date', 'unmatched.wav'))
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 1)
  assert.equal(library.warnings.length, 3)
  assert.match(library.warnings.map((w) => w.reason).join(' '), /missing.*Invalid.*no usable/)
  await saveLibraryCache(library, config)
  assert.deepEqual((await loadLibraryCache(config)).warnings, library.warnings)
})

test('missing or corrupt Pi databases report the exact expected file without creating it', async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  await assert.rejects(scanLibrary(config), (error) => error.message.includes(config.databasePath) && /Expected BirdNET-Pi\/scripts\/birds.db/.test(error.message))
  await assert.rejects(stat(config.databasePath), { code: 'ENOENT' })
  await writeFile(config.databasePath, 'not a sqlite database')
  await assert.rejects(scanLibrary(config), /Cannot read the BirdNET-Pi SQLite database/)
  await assert.rejects(readPiDatabase(config.archiveRoot), /Cannot read.*SQLite database/)
})

test('a database without the expected schema fails clearly', async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  const db = new DatabaseSync(config.databasePath)
  db.exec('CREATE TABLE unrelated (id INTEGER)')
  db.close()
  await assert.rejects(scanLibrary(config), /birds.db.*detections/)
})

test('a cached Pi library does not hide a missing database', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config)
  await recording(piPath(config))
  await saveLibraryCache(await scanLibrary(config), config)
  await rm(config.databasePath)
  await assert.rejects(loadLibraryCache(config), /Cannot read the BirdNET-Pi SQLite database/)
})

test('an empty Go archive is valid', async (t) => {
  const go = await fixture(t)
  assert.equal((await scanLibrary(go)).clips.length, 0)
})

test('empty Pi archives require valid metadata and unmatched audio is reported', nativePi, async (t) => {
  const pi = await fixture(t, 'birdnet-pi')
  database(pi, [])
  assert.equal((await scanLibrary(pi)).clips.length, 0)
  await recording(piPath(pi))
  await assert.rejects(scanLibrary(pi), /no usable matching database metadata/)
})

test('cache and review identities distinguish source, folder, database and station time zone', async (t) => {
  const config = await fixture(t)
  await recording(join(config.archiveRoot, goFilename))
  const first = await scanLibrary(config)
  await saveLibraryCache(first, config)
  const other = await fixture(t)
  await recording(join(other.archiveRoot, goFilename))
  assert.notEqual((await scanLibrary(other)).clips[0].id, first.clips[0].id)
  const utc = { ...config, sourceTimezone: 'UTC' }
  assert.equal(await loadLibraryCache(utc), null)
  assert.notEqual((await scanLibrary(utc)).clips[0].id, first.clips[0].id)
  assert.equal(await loadLibraryCache({ ...config, archiveRoot: other.archiveRoot }), null)
  const renamed = await loadLibraryCache({ ...config, station: { name: 'Renamed' } })
  assert.equal(renamed.summary().station.name, 'Renamed')
})

test('Pi cache and review identities distinguish source and required database', nativePi, async (t) => {
  const config = await fixture(t)
  await recording(join(config.archiveRoot, goFilename))
  await saveLibraryCache(await scanLibrary(config), config)
  const pi = await fixture(t, 'birdnet-pi')
  database(pi)
  await recording(piPath(pi))
  assert.equal(await loadLibraryCache({ ...pi, dataRoot: config.dataRoot }), null)
  await saveLibraryCache(await scanLibrary(pi), pi)
  const movedDB = { ...pi, databasePath: join(pi.projectRoot, 'other.db') }
  database(movedDB)
  assert.equal(await loadLibraryCache(movedDB), null)
  assert.notEqual((await scanLibrary(movedDB)).clips[0].id, (await scanLibrary(pi)).clips[0].id)
})

test('old cache schema requires a rescan', async (t) => {
  const config = await fixture(t)
  await mkdir(config.dataRoot)
  await writeFile(join(config.dataRoot, 'library-index.json'), JSON.stringify({ schemaVersion: 2, clips: [] }))
  assert.equal(await loadLibraryCache(config), null)
})

test('unavailable archives fail without replacing the saved index', async (t) => {
  const config = await fixture(t)
  const path = await recording(join(config.archiveRoot, goFilename))
  await saveLibraryCache(await scanLibrary(config), config)
  const indexPath = join(config.dataRoot, 'library-index.json')
  const before = await readFile(indexPath)
  await assert.rejects(scanLibrary({ ...config, archiveRoot: path }), /recording archive is unavailable/)
  await rm(config.archiveRoot, { recursive: true })
  await assert.rejects(scanLibrary(config), /recording archive is unavailable/)
  assert.deepEqual(await readFile(indexPath), before)
})

test('unrecognised or ambiguous Go clips produce visible diagnostics', async (t) => {
  const config = await fixture(t)
  await recording(join(config.archiveRoot, goFilename))
  await recording(join(config.archiveRoot, 'parus_major_72p_20261025T013000Z.wav'))
  await recording(join(config.archiveRoot, 'not-birdnet.wav'))
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 1)
  assert.equal(library.warnings.length, 2)
  assert.ok(library.warnings.some((item) => /Ambiguous/.test(item.reason)))
})

test('symlink views do not duplicate recordings or scan files outside the selected archive', { skip: process.platform === 'win32' }, async (t) => {
  const config = await fixture(t)
  const path = await recording(join(config.archiveRoot, goFilename))
  await symlink(path, join(config.archiveRoot, 'parus_major_72p_20260515T130000Z.wav'))
  const outside = await fixture(t)
  await recording(join(outside.archiveRoot, goFilename))
  await symlink(outside.archiveRoot, join(config.archiveRoot, 'outside'))
  assert.equal((await scanLibrary(config)).clips.length, 1)
})

test('Pi metadata is consumed one row at a time, before the next SQLite row is fetched', async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config, [])
  const db = new DatabaseSync(config.databasePath)
  db.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 10000) INSERT INTO detections (Date, Time, Sci_Name, Com_Name, Confidence, File_Name) SELECT '2026-05-15', '12:00:00', 'Parus major', 'Great Tit', 0.72, 'old-' || n || '.wav' FROM seq")
  db.close()
  let fetched = 0, consumed = 0
  const prepare = DatabaseSync.prototype.prepare
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql)
    const iterate = statement.iterate.bind(statement)
    statement.all = () => { throw new Error('Detections must not be materialised with all()') }
    statement.iterate = function* () {
      for (const row of iterate()) { fetched++; yield row }
    }
    return statement
  })
  assert.equal(await readPiDatabase(config.databasePath, { onRow() {
    consumed++
    assert.equal(fetched, consumed, 'the next database row must not be fetched before this row is handled')
  } }), 10000)
  assert.equal(consumed, 10000)
})

test('old Pi database records are reported as normal retention with bounded examples', nativePi, async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config)
  const db = new DatabaseSync(config.databasePath)
  db.exec("WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 10000) INSERT INTO detections (Date, Time, Sci_Name, Com_Name, Confidence, File_Name) SELECT '2020-01-01', '12:00:00', 'Parus major', 'Great Tit', 0.72, 'expired-' || n || '.wav' FROM seq")
  db.close()
  await recording(piPath(config))
  const library = await scanLibrary(config)
  assert.equal(library.clips.length, 1)
  assert.equal(library.warnings.length, 1)
  assert.match(library.warnings[0].reason, /normal.*BirdNET-Pi deletes old recordings.*keeps.*records/)
  assert.equal(library.warnings[0].count, 10000)
  assert.equal(library.warnings[0].examples.length, 3)
})

test('Pi database closes after a row consumer fails', async (t) => {
  const config = await fixture(t, 'birdnet-pi')
  database(config)
  await assert.rejects(readPiDatabase(config.databasePath, { onRow() { throw new Error('stop reading') } }), /stop reading/)
  const db = new DatabaseSync(config.databasePath)
  try { db.exec('BEGIN EXCLUSIVE; ROLLBACK') }
  finally { db.close() }
})
