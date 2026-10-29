import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Bump whenever parseAstats changes how it scores, so cached metrics computed by
 * an older formula are discarded rather than ranked alongside new ones.
 * 2: -inf overall measurements are read as unmeasurable instead of falling back
 *    to a per-channel figure; the no-clipping bonus needs a measured peak.
 */
export const SCORING_VERSION = 2

export class AudioAnalyser {
  constructor(store) {
    this.store = store
    this.inflight = new Map()
  }

  async analyse(clip) {
    const cached = this.store.metrics[clip.id]
    if (cached && !cached.error) return { ...clip, analysis: cached }
    if (this.inflight.has(clip.id)) return this.inflight.get(clip.id)

    const pending = this.runAnalysis(clip).finally(() => this.inflight.delete(clip.id))
    this.inflight.set(clip.id, pending)
    return pending
  }

  async runAnalysis(clip) {
    let analysis
    try {
      const { stderr } = await execFileAsync('ffmpeg', [
        '-hide_banner', '-nostats', '-i', clip.path,
        '-af', 'highpass=f=300,lowpass=f=12000,astats=metadata=1:reset=0',
        '-f', 'null', '-',
      ], { maxBuffer: 2 * 1024 * 1024, timeout: 12_000, killSignal: 'SIGKILL' })
      analysis = parseAstats(stderr, clip.confidence)
    } catch (error) {
      const analysis = {
        score: Math.round(clip.confidence * 0.55 * 10) / 10,
        error: error.killed ? 'Analysis timed out' : 'Audio could not be analysed',
      }
      // A disconnected archive or a transient decoder failure must be retryable.
      // Only successful measurements belong in the persistent cache.
      return { ...clip, analysis }
    }
    this.store.metrics[clip.id] = analysis
    // Storage failures are not audio failures: preserve the measurement and
    // report the real error rather than replacing it with a low fallback score.
    await this.store.save()
    return { ...clip, analysis }
  }
}

export function parseAstats(output, confidence = 0) {
  const peakDb = lastNumber(output, 'Peak level dB')
  const rmsDb = lastNumber(output, 'RMS level dB')
  const rmsPeakDb = lastNumber(output, 'RMS peak dB')
  const noiseFloorDb = lastNumber(output, 'Noise floor dB')
  const dynamicRangeDb = lastNumber(output, 'Dynamic range')
  const entropy = lastNumber(output, 'Entropy')
  const estimatedSnrDb = finite(rmsPeakDb) && finite(noiseFloorDb) ? rmsPeakDb - noiseFloorDb : null
  const clippingRisk = finite(peakDb) && peakDb > -0.5
  const score = clamp(
    confidence * 0.55 +
    scale(estimatedSnrDb, 3, 28) * 25 +
    scale(peakDb, -55, -6) * 15 +
    (finite(peakDb) && !clippingRisk ? 5 : 0),
    0,
    100,
  )
  return {
    score: round(score),
    estimatedSnrDb: roundOrNull(estimatedSnrDb),
    peakDb: roundOrNull(peakDb),
    rmsDb: roundOrNull(rmsDb),
    noiseFloorDb: roundOrNull(noiseFloorDb),
    dynamicRangeDb: roundOrNull(dynamicRangeDb),
    entropy: roundOrNull(entropy, 3),
    clippingRisk,
  }
}

function lastNumber(output, label) {
  // ffmpeg reports silent audio as -inf (and occasionally nan). Those must still
  // MATCH here so that the final Overall block wins; a digits-only pattern skips
  // them and silently returns the preceding per-channel figure instead.
  const matches = [...output.matchAll(new RegExp(`${escapeRegExp(label)}:\\s*(-?(?:[0-9]+(?:\\.[0-9]+)?|inf|nan))`, 'gi'))]
  if (!matches.length) return null
  const value = Number(matches.at(-1)[1])
  return Number.isFinite(value) ? value : null
}

function scale(value, low, high) {
  if (!finite(value)) return 0
  return clamp((value - low) / (high - low), 0, 1)
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function round(value, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function roundOrNull(value, places = 1) {
  return finite(value) ? round(value, places) : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
