import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

// Read only literal coordinates, not arbitrary YAML/shell syntax. Native config
// files are data: never source them, expand variables or evaluate expressions.
export function parseStationCoordinates(source, content) {
  const values = new Map()
  let inBirdnet = false, childIndent
  for (const line of content.split(/\r?\n/)) {
    let match
    if (source === 'birdnet-pi') {
      match = /^(?:export\s+)?(LATITUDE|LONGITUDE)\s*=\s*(.*)$/.exec(line.trim())
    } else {
      if (/^\S/.test(line) && !line.startsWith('#')) {
        inBirdnet = /^birdnet:\s*(?:#.*)?$/.test(line)
        childIndent = undefined
      }
      if (inBirdnet) {
        const child = /^( +)[a-zA-Z_][a-zA-Z0-9_]*:/.exec(line)
        if (child) childIndent ??= child[1].length
        if (child && child[1].length === childIndent) match = /^\s+(latitude|longitude):\s*(.*)$/.exec(line)
      }
    }
    if (!match) continue
    const key = match[1].toLowerCase()
    if (values.has(key)) throw new Error(`Duplicate ${key} in the station configuration; enter it manually in station.${key}.`)
    values.set(key, match[2])
  }
  const station = {}
  const warnings = []
  for (const [key, raw] of values) {
    const literal = /^(?:"([^"]*)"|'([^']*)'|([^#]*?))\s*(?:#.*)?$/.exec(raw)
    const text = literal && (literal[1] ?? literal[2] ?? literal[3]).trim()
    const number = text && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : NaN
    if (!Number.isFinite(number) || Math.abs(number) > (key === 'latitude' ? 90 : 180)) {
      warnings.push(`Could not import ${key}: use a literal number in range, or set station.${key} manually.`)
    } else station[key] = number
  }
  if (!values.size) warnings.push('No literal station coordinates found. Set station.latitude and station.longitude manually if needed.')
  return { station, warnings }
}

export async function discoverStationMetadata(source, explicitPath, archiveRoot) {
  const filename = source === 'birdnet-pi' ? 'birdnet.conf' : 'config.yaml'
  // Only nearby files: a copied archive must not inherit the host's unrelated
  // /etc configuration or coordinates. Non-adjacent configs can be selected.
  const candidates = explicitPath ? [explicitPath] : archiveRoot ? [
    join(archiveRoot, filename), join(dirname(archiveRoot), filename),
    ...(source === 'birdnet-go' ? [join(dirname(archiveRoot), 'config', filename)] : []),
  ] : []
  for (const path of [...new Set(candidates.map((path) => resolve(path)))]) {
    try {
      return { ...parseStationCoordinates(source, await readFile(path, 'utf8')), path }
    } catch (error) {
      if (!explicitPath && error.code === 'ENOENT') continue
      throw new Error(`Cannot read station metadata from ${path}: ${error.message}`, { cause: error })
    }
  }
  return { station: {}, warnings: [], path: undefined }
}
