import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readPiDatabase, scanSource, sourceIdentity } from './sources.js'
import { loadCommonNames } from './common-names.js'
import { zonedTime } from './time.js'
export { parseClipFilename } from './sources.js'
export { zonedTime } from './time.js'

export async function scanLibrary(config, onProgress = () => {}) {
  const { clips, warnings } = await scanSource(config)
  const { names, fallbackNames, warnings: nameWarnings } = await loadCommonNames(config)
  warnings.push(...nameWarnings)
  const source = sourceIdentity(config)
  for (const clip of clips) {
    clip.id = createHash('sha256').update(`${source}\0${clip.relPath}\0${clip.scientificName}`).digest('hex').slice(0, 24)
    clip.commonName = commonNameFor(names, clip.slug) || clip.commonName || commonNameFor(fallbackNames, clip.slug) || ''
  }
  onProgress({ count: clips.length })
  return new BirdLibrary(clips, config, warnings)
}

async function cacheSource(config) {
  const paths = [config.labelsPath, config.source === 'birdnet-go' ? config.databasePath : undefined]
  const signatures = []
  for (const path of paths) {
    if (!path) { signatures.push(null); continue }
    for (const file of [path, ...(path === config.databasePath ? [`${path}-wal`] : [])]) {
      try {
        const info = await stat(file)
        signatures.push([file, info.size, info.mtimeMs])
      } catch (error) { signatures.push([file, error.code]) }
    }
  }
  return JSON.stringify([sourceIdentity(config), signatures])
}

export async function loadLibraryCache(config) {
  // A cached index must not hide a missing or unreadable required database.
  if (config.source === 'birdnet-pi') await readPiDatabase(config.databasePath, { checkOnly: true })
  try {
    const cached = JSON.parse(await readFile(join(config.dataRoot, 'library-index.json'), 'utf8'))
    if (cached.schemaVersion !== 5 || cached.source !== await cacheSource(config) || !Array.isArray(cached.clips)) return null
    const clips = cached.clips.map((clip) => ({ ...clip, path: join(config.archiveRoot, clip.relPath) }))
    return new BirdLibrary(clips, config, cached.warnings || [])
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Ignoring unreadable library cache: ${error.message}`)
    return null
  }
}

export async function saveLibraryCache(library, config) {
  const path = join(config.dataRoot, 'library-index.json')
  const temporary = `${path}.tmp`
  await mkdir(config.dataRoot, { recursive: true })
  await writeFile(temporary, JSON.stringify({
    schemaVersion: 5, source: await cacheSource(config), generatedAt: new Date().toISOString(),
    clips: library.clips.map(({ path, ...clip }) => clip), warnings: library.warnings,
  }))
  await rename(temporary, path)
}

export class BirdLibrary {
  constructor(clips, config, warnings = []) {
    this.clips = clips
    this.byId = new Map(clips.map((clip) => [clip.id, clip]))
    this.config = config
    this.warnings = warnings
    const species = new Map()
    for (const clip of clips) {
      if (!species.has(clip.slug)) species.set(clip.slug, {
        slug: clip.slug, scientificName: clip.scientificName, commonName: clip.commonName || '', count: 0,
      })
      species.get(clip.slug).count++
    }
    this.species = [...species.values()].sort((a, b) => (a.commonName || a.scientificName).localeCompare(b.commonName || b.scientificName))
  }

  summary() {
    return {
      clipCount: this.clips.length, speciesCount: this.species.length,
      species: this.species, station: this.station(), source: this.config.source, warnings: this.warnings,
    }
  }

  findCandidates({ species, from, to, minConfidence = 70, limit = 24 }) {
    if (!species) throw new Error('Choose a species')
    const timeZone = this.config.timezone || 'UTC'
    const fromTime = from ? zonedTime(from, '00:00:00.000', timeZone) : -Infinity
    const toTime = to ? zonedTime(to, '23:59:59.999', timeZone) : Infinity
    const matches = this.clips.filter((clip) => {
      const time = Date.parse(clip.timestamp)
      return clip.slug === species && clip.confidence >= Number(minConfidence) && time >= fromTime && time <= toTime
    })
    matches.sort((a, b) => b.confidence - a.confidence || Date.parse(b.timestamp) - Date.parse(a.timestamp))
    return spreadAcrossTime(matches, Math.min(Math.max(Number(limit) || 24, 1), 60))
  }

  get(id) { return this.byId.get(id) }
  station() { return this.config.station || {} }
}

export function spreadAcrossTime(clips, limit, separationSeconds = 90) {
  const selected = []
  for (const clip of clips) {
    const time = Date.parse(clip.timestamp)
    if (!selected.some((other) => Math.abs(Date.parse(other.timestamp) - time) < separationSeconds * 1000)) selected.push(clip)
    if (selected.length >= limit) break
  }
  if (selected.length < limit) {
    for (const clip of clips) {
      if (!selected.includes(clip)) selected.push(clip)
      if (selected.length >= limit) break
    }
  }
  return selected
}

const LABEL_ALIASES = new Map([['coloeus_monedula', 'corvus_monedula']])

export function commonNameFor(commonNames, slug) {
  return commonNames.get(slug) || commonNames.get(LABEL_ALIASES.get(slug)) || ''
}
