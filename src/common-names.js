import { readFile } from 'node:fs/promises'
import { loadSqlite } from './sqlite.js'

const slugFor = (name) => name.trim().toLowerCase().replaceAll(' ', '_')

let bundledNames
async function loadBundledNames() {
  bundledNames ||= readFile(new URL('../resources/common-names.en.json', import.meta.url), 'utf8')
    .then((content) => new Map(Object.entries(JSON.parse(content)).map(([scientific, common]) => [slugFor(scientific), common])))
  return bundledNames
}

export async function loadCommonNames(config) {
  const names = new Map()
  const warnings = []
  if (config.source === 'birdnet-go' && config.databasePath) {
    let db
    try {
      const { DatabaseSync } = await loadSqlite()
      db = new DatabaseSync(config.databasePath, { readOnly: true })
      const tables = new Set([...db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('notes', 'labels')").iterate()].map((row) => row.name))
      if (tables.has('notes')) {
        for (const row of db.prepare('SELECT scientific_name, common_name FROM notes ORDER BY rowid DESC').iterate()) {
          if (typeof row.scientific_name !== 'string' || typeof row.common_name !== 'string' || !row.common_name.trim()) continue
          const slug = slugFor(row.scientific_name)
          if (slug && !names.has(slug)) names.set(slug, row.common_name.trim())
        }
      } else if (tables.has('labels')) {
        // Some v2 databases retain older ScientificName_CommonName labels.
        // Current scientific-only labels need no guessed translation.
        for (const row of db.prepare('SELECT scientific_name FROM labels').iterate()) {
          const label = splitLabel(row.scientific_name)
          if (label && !names.has(label[0])) names.set(...label)
        }
      }
    } catch (error) {
      warnings.push({ message: `Could not read optional BirdNET-Go common names from ${config.databasePath} (${error.message}). Bundled English names are used where available; labelsPath can supply or override names.` })
    } finally { db?.close() }
  }
  if (config.labelsPath) {
    let content
    try { content = await readFile(config.labelsPath, 'utf8') }
    catch (error) { throw new Error(`Cannot read labelsPath ${config.labelsPath}: ${error.message}`, { cause: error }) }
    for (const line of content.split(/\r?\n/)) {
      const label = splitLabel(line)
      if (label) names.set(...label)
    }
  }
  return { names, fallbackNames: await loadBundledNames(), warnings }
}

function splitLabel(value) {
  if (typeof value !== 'string') return null
  const separator = value.indexOf('_')
  if (separator < 1) return null
  const scientific = slugFor(value.slice(0, separator))
  const common = value.slice(separator + 1).trim()
  return scientific && common ? [scientific, common] : null
}
