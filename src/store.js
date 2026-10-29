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
    const clean = validateReview(patch)
    this.reviews[id] = { ...(this.reviews[id] || {}), ...clean, updatedAt: new Date().toISOString() }
    return this.reviews[id]
  }

  saveReview(id, patch) {
    const clean = validateReview(patch)
    return this.enqueue(async () => {
      const review = { ...(this.reviews[id] || {}), ...clean, updatedAt: new Date().toISOString() }
      await this.writeState({ reviews: { ...this.reviews, [id]: review } })
      this.reviews[id] = review
      return review
    })
  }

  saveUploadDefaults(key, details) {
    const saved = { ...details }
    return this.enqueue(async () => {
      await this.writeState({ uploadDefaults: { ...this.uploadDefaults, [key]: saved } })
      this.uploadDefaults[key] = saved
    })
  }

  save() { return this.enqueue(() => this.writeState()) }

  enqueue(operation) {
    // Serialise durable changes; a failure must not poison later operations.
    this.saveQueue = this.saveQueue.catch(() => {}).then(operation)
    return this.saveQueue
  }

  async writeState(changes = {}) {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, metricsVersion: SCORING_VERSION, metrics: this.metrics, reviews: this.reviews, uploadDefaults: this.uploadDefaults, ...changes }, null, 2))
    await rename(temporary, this.path)
  }

}

function validateReview(patch) {
  const invalid = message => Object.assign(new Error(message), { statusCode: 400 })
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw invalid('Review must be an object.')
  const textFields = ['commonName', 'vocalisationType', 'backgroundSpecies', 'remarks', 'sex', 'lifeStage', 'animalSeen', 'playbackUsed', 'location', 'country', 'device', 'microphone']
  const clean = {}
  for (const field of textFields) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (typeof value !== 'string' || value.length > (['remarks', 'backgroundSpecies'].includes(field) ? 4000 : 300)) throw invalid(`Invalid ${field}.`)
    clean[field] = value
  }
  if (Object.hasOwn(patch, 'decision')) {
    if (!['', 'keep', 'reject'].includes(patch.decision)) throw invalid('Invalid review decision.')
    clean.decision = patch.decision
  }
  if (Object.hasOwn(patch, 'confirmed')) {
    if (typeof patch.confirmed !== 'boolean') throw invalid('Confirmation must be true or false.')
    clean.confirmed = patch.confirmed
  }
  for (const [field, limit] of [['latitude', 90], ['longitude', 180], ['elevation', Infinity]]) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (!['string', 'number'].includes(typeof value)) throw invalid(`Invalid ${field}.`)
    if (String(value).trim() !== '' && (!Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit)) throw invalid(`Invalid ${field}.`)
    clean[field] = value
  }
  return clean
}
