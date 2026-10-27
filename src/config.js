import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverStationMetadata } from './station-config.js'
import { checkSourcePlatform } from './platform.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hasValue = (value) => value !== undefined && value !== null && value !== ''

export async function loadConfig(explicitPath, options = {}) {
  const { archive, source, database, sourceTimezone, stationConfig, env = process.env, projectRoot: root = projectRoot, workspaceRoot = process.cwd() } = options
  const configPath = explicitPath ? resolve(explicitPath) : resolve(workspaceRoot, 'config/station.local.json')
  let parsed, firstRun = false
  try { parsed = JSON.parse(await readFile(configPath, 'utf8')) }
  catch (error) {
    if (explicitPath || error.code !== 'ENOENT') throw error
    const example = source === 'birdnet-pi' ? 'birdnet-pi.example.json' : 'station.example.json'
    parsed = JSON.parse(await readFile(join(root, 'config', example), 'utf8'))
    firstRun = true
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid configuration: ${configPath}`)
  if ('archiveMode' in parsed || 'monitors' in parsed) {
    throw new Error(`This configuration uses the old custom archive setup. Use config/station.example.json for a single BirdNET-Go or BirdNET-Pi station: ${configPath}`)
  }
  const selectedSource = source ?? parsed.source
  checkSourcePlatform(selectedSource)
  if (!['birdnet-go', 'birdnet-pi'].includes(selectedSource)) {
    throw new Error('Choose a recording source: set source in the config or pass --source birdnet-go or --source birdnet-pi.')
  }
  if (parsed.station !== undefined && (!parsed.station || typeof parsed.station !== 'object' || Array.isArray(parsed.station))) {
    throw new Error('station must be an object containing this station’s location and recorder details.')
  }
  const selectedArchive = archive ?? env.PECKING_ORDER_ARCHIVE ?? parsed.archiveRoot
  const archiveBase = archive !== undefined || env.PECKING_ORDER_ARCHIVE !== undefined ? process.cwd() : dirname(configPath)
  const archiveRoot = typeof selectedArchive === 'string' && selectedArchive.trim() ? resolve(archiveBase, selectedArchive) : ''
  const nativePath = stationConfig ?? parsed.stationConfigPath
  const stationConfigPath = nativePath ? resolve(stationConfig !== undefined ? process.cwd() : dirname(configPath), nativePath) : undefined
  const metadata = await discoverStationMetadata(selectedSource, stationConfigPath, archiveRoot)
  const station = { name: 'My station', ...parsed.station }
  for (const [key, value] of Object.entries(metadata.station)) if (!hasValue(station[key])) station[key] = value
  let databasePath = database ?? (selectedSource === parsed.source ? parsed.databasePath : undefined)
  if (databasePath) databasePath = resolve(database !== undefined ? process.cwd() : dirname(configPath), databasePath)
  // Go metadata is optional. Only look beside this archive, never in an
  // unrelated checkout or in the host's home directory.
  if (!databasePath && selectedSource === 'birdnet-go' && archiveRoot) {
    const nearbyDatabase = join(dirname(archiveRoot), 'birdnet.db')
    try { if ((await stat(nearbyDatabase)).isFile()) databasePath = nearbyDatabase }
    catch (error) { if (error.code !== 'ENOENT') metadata.warnings.push(`Could not inspect optional BirdNET-Go database ${nearbyDatabase}: ${error.message}`) }
  }
  const selectedTimezone = sourceTimezone ?? parsed.sourceTimezone ?? ''
  const timezone = parsed.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const resolved = {
    ...parsed, source: selectedSource, archiveRoot, databasePath: databasePath || undefined,
    sourceTimezone: selectedTimezone, timezone, country: parsed.country || '', station,
    stationConfigPath: metadata.path,
    labelsPath: parsed.labelsPath ? resolve(dirname(configPath), parsed.labelsPath) : undefined,
  }
  // Save first-run choices and discovered coordinates even if setup still needs
  // the recording time zone. Existing user configs are never rewritten.
  if (firstRun) {
    await mkdir(dirname(configPath), { recursive: true })
    try { await writeFile(configPath, JSON.stringify(resolved, null, 2) + '\n', { flag: 'wx' }) }
    catch (error) {
      if (error.code !== 'EEXIST') throw error
      return loadConfig(explicitPath, options)
    }
  }
  if (!archiveRoot) {
    throw new Error(`No recording archive configured. Set archiveRoot in ${configPath}, set PECKING_ORDER_ARCHIVE, or pass --archive PATH.`)
  }
  if (typeof selectedTimezone !== 'string' || !selectedTimezone.trim()) {
    throw new Error(`Confirm the recording station’s time zone: set sourceTimezone in ${configPath} or pass --source-timezone (for example Europe/London or UTC). The display time zone and BirdNET-Go logging.timezone do not establish the recording clock.`)
  }
  for (const zone of [selectedTimezone, timezone]) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format() }
    catch { throw new Error(`Unknown time zone: ${zone}`) }
  }
  if (selectedSource === 'birdnet-pi' && !databasePath) {
    throw new Error('BirdNET-Pi needs its SQLite database: set databasePath or pass --database PATH to BirdNET-Pi/scripts/birds.db. BirdDB.txt is not supported.')
  }
  return {
    ...resolved, setupWarnings: metadata.warnings,
    path: configPath, projectRoot: root, workspaceRoot: resolve(workspaceRoot),
    dataRoot: resolve(workspaceRoot, 'data'), exportRoot: resolve(workspaceRoot, 'exports'),
  }
}
