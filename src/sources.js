import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { loadSqlite } from './sqlite.js'
import { recordingTimestamp } from './time.js'

const AUDIO = /\.(flac|wav|mp3|ogg|m4a|opus)$/i
const GO_FILENAME = /^(.+)_([0-9]{1,3})p_([0-9]{8}T[0-9]{6}Z)(?:_[0-9]+s)?\.(flac|wav|mp3|ogg|m4a|opus)$/i

export function sourceIdentity(config) {
  return JSON.stringify([config.source, resolve(config.archiveRoot), config.source === 'birdnet-pi' ? config.databasePath || '' : '', config.sourceTimezone])
}

export function parseClipFilename(filename, timeZone = 'UTC') {
  const match = basename(filename).match(GO_FILENAME)
  if (!match) return null
  const [, slug, confidenceText, timestamp, extension] = match
  if (Number(confidenceText) > 100) return null
  const date = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`
  const time = `${timestamp.slice(9, 11)}:${timestamp.slice(11, 13)}:${timestamp.slice(13, 15)}`
  return {
    slug: slug.toLowerCase(),
    scientificName: slug.split('_').map((part, i) => i ? part.toLowerCase() : part[0].toUpperCase() + part.slice(1).toLowerCase()).join(' '),
    confidence: Number(confidenceText), timestamp: recordingTimestamp(date, time, timeZone),
    extension: extension.toLowerCase(),
  }
}

function diagnostics() {
  const issues = new Map()
  return {
    add(reason, example) {
      if (!issues.has(reason)) issues.set(reason, { reason, count: 0, examples: [] })
      const issue = issues.get(reason)
      issue.count++
      if (issue.examples.length < 3) issue.examples.push(example)
    },
    list() { return [...issues.values()] },
  }
}

export async function scanSource(config) {
  try {
    await access(config.archiveRoot, constants.R_OK)
    if (!(await stat(config.archiveRoot)).isDirectory()) throw new Error('Expected a directory')
  } catch (error) {
    throw new Error(`The recording archive is unavailable: ${config.archiveRoot}. Check that the folder exists and is readable.`, { cause: error })
  }
  if (config.source === 'birdnet-pi') return scanPi(config)
  if (config.source !== 'birdnet-go') throw new Error('Choose source birdnet-go or birdnet-pi.')
  const issues = diagnostics()
  const paths = await findAudioFiles(config.archiveRoot)
  const clips = []
  for (const path of paths) {
    try {
      const parsed = parseClipFilename(path, config.sourceTimezone)
      if (!parsed) { issues.add('Unrecognised BirdNET-Go filename', relative(config.archiveRoot, path)); continue }
      clips.push({ ...parsed, path, relPath: relative(config.archiveRoot, path) })
    } catch (error) {
      issues.add(error.message, relative(config.archiveRoot, path))
    }
  }
  return finish(clips, issues, paths.length, 'BirdNET-Go', config.archiveRoot)
}

function finish(clips, issues, expected, source, archive) {
  const warnings = issues.list()
  if (!clips.length && expected) {
    throw new Error(`No usable ${source} recordings found in ${archive}. ${warnings.map((issue) => `${issue.reason} (${issue.count}; ${issue.examples.join(', ')})`).join('. ')}`)
  }
  return { clips, warnings }
}

async function scanPi(config) {
  // Validate the database even for empty archives: missing metadata is never an
  // empty library. The only open is read-only, so missing files cannot be created.
  await readPiDatabase(config.databasePath, { checkOnly: true })
  const clipsRoot = basename(config.archiveRoot) === 'By_Date' ? config.archiveRoot : join(config.archiveRoot, 'By_Date')
  let paths
  try { paths = await findAudioFiles(clipsRoot) }
  catch (error) {
    throw new Error(`BirdNET-Pi recordings could not be read at ${clipsRoot}. Point --archive at the extracted-recordings folder or its By_Date folder. ${error.message}`, { cause: error })
  }
  const issues = diagnostics()
  const files = new Map(paths.map((path) => [relative(clipsRoot, path).split(sep).join('/'), path]))
  const matched = new Set()
  const records = new Map()
  const conflicts = new Set()
  const rowCount = await readPiDatabase(config.databasePath, { onRow(row) {
    const filename = row.File_Name
    try {
      if (typeof filename !== 'string' || /[/\\]/.test(filename) || !AUDIO.test(filename)) throw new Error('Invalid recording filename in database')
      if (typeof row.Sci_Name !== 'string' || !row.Sci_Name.trim() || typeof row.Com_Name !== 'string' || !row.Com_Name.trim()) throw new Error('Missing species metadata in database')
      const commonFolder = row.Com_Name.replaceAll("'", '').replaceAll(' ', '_')
      if (/[/\\]/.test(commonFolder)) throw new Error('Invalid common-name folder in database')
      const confidence = Number(row.Confidence)
      if (row.Confidence === null || row.Confidence === '' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Invalid confidence in database')
      const key = `${row.Date}/${commonFolder}/${filename}`
      const path = files.get(key)
      if (!path) { issues.add('Recording missing from the archive — this is normal when BirdNET-Pi deletes old recordings but keeps their database records', filename); return }
      const timestamp = recordingTimestamp(row.Date, row.Time, config.sourceTimezone)
      matched.add(key)
      const scientificName = row.Sci_Name.trim()
      const parsed = {
        path, relPath: relative(config.archiveRoot, path), timestamp, scientificName,
        slug: scientificName.toLowerCase().replaceAll(' ', '_'), commonName: row.Com_Name.trim(),
        confidence: confidence * 100, extension: extname(filename).slice(1).toLowerCase(),
      }
      const previous = records.get(key)
      if (previous && (previous.scientificName !== scientificName || previous.timestamp !== timestamp || previous.commonName !== parsed.commonName)) {
        if (!conflicts.has(key)) issues.add('Conflicting database identifications for one recording', filename)
        conflicts.add(key)
      } else if (!previous || parsed.confidence > previous.confidence) records.set(key, parsed)
    } catch (error) {
      issues.add(error.message, typeof filename === 'string' ? filename : '(missing filename)')
    }
  } })
  for (const key of files.keys()) if (!matched.has(key)) issues.add('Recording has no usable matching database metadata', key)
  const clips = [...records].filter(([key]) => !conflicts.has(key)).map(([, clip]) => clip)
  return finish(clips, issues, paths.length || rowCount, 'BirdNET-Pi', config.archiveRoot)
}

export async function readPiDatabase(databasePath, { checkOnly = false, onRow = () => {} } = {}) {
  const expected = databasePath || 'BirdNET-Pi/scripts/birds.db'
  let db
  try {
    if (!databasePath) throw new Error('Set databasePath or pass --database PATH')
    const { DatabaseSync } = await loadSqlite()
    db = new DatabaseSync(databasePath, { readOnly: true })
    const statement = db.prepare('SELECT Date, Time, Sci_Name, Com_Name, Confidence, File_Name FROM detections')
    if (checkOnly) return 0
    let count = 0
    for (const row of statement.iterate()) { onRow(row); count++ }
    return count
  } catch (error) {
    throw new Error(`Cannot read the BirdNET-Pi SQLite database: ${expected}. Expected BirdNET-Pi/scripts/birds.db with its detections table; check --database or databasePath and read permissions. ${error.message}`, { cause: error })
  } finally {
    db?.close()
  }
}

async function findAudioFiles(root) {
  const paths = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && AUDIO.test(entry.name)) paths.push(path)
      // BirdNET-Pi's other views can contain links to the same recordings.
      // Only regular files in the selected archive are indexed.
    }
  }
  return paths.sort()
}
