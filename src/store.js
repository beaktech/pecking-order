import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { SCORING_VERSION } from './analyse.js'
import { dirname, join } from 'node:path'

export class Store {
  constructor(dataRoot) {
    this.path = join(dataRoot, 'state.json')
    this.metrics = {}
    this.reviews = {}
    this.uploadDefaults = {}
    this.saveQueue = Promise.resolve()
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      // Reviews are the user's own work and always survive. Metrics are a cache
      // of a formula, so they are dropped when that formula has moved on.
      this.reviews = parsed.reviews || {}
      this.uploadDefaults = parsed.uploadDefaults || {}
      const stale = (parsed.metricsVersion || 1) !== SCORING_VERSION
      this.metrics = stale ? {} : Object.fromEntries(Object.entries(parsed.metrics || {}).filter(([, metric]) => metric && !metric.error))
      if (stale && Object.keys(parsed.metrics || {}).length) {
        console.log(`Quality scoring has changed; ${Object.keys(parsed.metrics).length} cached measurements will be recalculated.`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return this
  }

  updateReview(id, patch) {
    const permitted = [
      'decision', 'confirmed', 'commonName', 'vocalisationType', 'backgroundSpecies',
      'remarks', 'sex', 'lifeStage', 'animalSeen', 'playbackUsed', 'location',
      'country', 'latitude', 'longitude', 'elevation', 'device', 'microphone',
    ]
    const clean = Object.fromEntries(Object.entries(patch).filter(([key]) => permitted.includes(key)))
    this.reviews[id] = { ...(this.reviews[id] || {}), ...clean, updatedAt: new Date().toISOString() }
    return this.reviews[id]
  }

  async save() {
    // A failed write must reach its caller without poisoning subsequent saves.
    this.saveQueue = this.saveQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, metricsVersion: SCORING_VERSION, metrics: this.metrics, reviews: this.reviews, uploadDefaults: this.uploadDefaults }, null, 2))
      await rename(temporary, this.path)
    })
    return this.saveQueue
  }
}
