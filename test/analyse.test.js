import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAstats } from '../src/analyse.js'

test('extracts final overall audio measurements and scores them', () => {
  const output = `
    Peak level dB: -30.0
    RMS level dB: -50.0
    RMS peak dB: -40.0
    Noise floor dB: -52.0
    Overall
    Peak level dB: -12.5
    RMS level dB: -36.2
    RMS peak dB: -23.1
    Noise floor dB: -48.6
    Dynamic range: 70.2
    Entropy: 0.531
  `
  const result = parseAstats(output, 92)
  assert.equal(result.peakDb, -12.5)
  assert.equal(result.estimatedSnrDb, 25.5)
  assert.equal(result.dynamicRangeDb, 70.2)
  assert.equal(result.clippingRisk, false)
  assert.ok(result.score > 85)
})

test('flags peaks close to digital clipping', () => {
  const result = parseAstats('Peak level dB: -0.1\nRMS peak dB: -12\nNoise floor dB: -30', 90)
  assert.equal(result.clippingRisk, true)
})

test('treats -inf overall measurements as unmeasurable, not as channel values', () => {
  // ffmpeg prints -inf for silent audio. The Overall block is what matters, but
  // a regex that only matches digits skips it and silently reports the last
  // per-channel figure instead, scoring silence as if it were a strong recording.
  const output = `
    Channel: 1
    Peak level dB: -12.5
    RMS peak dB: -23.1
    Noise floor dB: -48.6
    Overall
    Peak level dB: -inf
    RMS peak dB: -inf
    Noise floor dB: -inf
  `
  const result = parseAstats(output, 90)
  assert.equal(result.peakDb, null)
  assert.equal(result.estimatedSnrDb, null)
  assert.equal(result.clippingRisk, false)
  assert.ok(result.score < 55, `silence should not outrank real audio, got ${result.score}`)
})

test('does not award the no-clipping bonus when the peak could not be measured', () => {
  const measured = parseAstats('Overall\nPeak level dB: -20\nRMS peak dB: -25\nNoise floor dB: -45', 80)
  const unmeasured = parseAstats('Overall\nPeak level dB: -inf\nRMS peak dB: -inf\nNoise floor dB: -inf', 80)
  assert.ok(measured.score > unmeasured.score)
})

import { AudioAnalyser } from '../src/analyse.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)

test('retries failed analysis when the archive recording becomes available', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-analysis-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const clip = { id: 'bird', path: join(root, 'bird.wav'), confidence: 90 }
  let saves = 0
  const store = { metrics: {}, save: async () => { saves++ } }
  const analyser = new AudioAnalyser(store)
  assert.ok((await analyser.analyse(clip)).analysis.error)
  assert.equal(store.metrics.bird, undefined)
  assert.equal(saves, 0)
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', clip.path])
  const result = await analyser.analyse(clip)
  assert.equal(result.analysis.error, undefined)
  assert.ok(Number.isFinite(result.analysis.peakDb))
  assert.equal(saves, 1)
  assert.deepEqual((await analyser.analyse(clip)).analysis, result.analysis)
  assert.equal(saves, 1)
})

test('does not misreport a failed metrics save as a bad recording', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-analysis-save-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'bird.wav')
  await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', path])
  const store = { metrics: {}, save: async () => { throw new Error('Disk full') } }
  await assert.rejects(new AudioAnalyser(store).analyse({ id: 'bird', path, confidence: 90 }), /Disk full/)
  assert.equal(store.metrics.bird.error, undefined)
  assert.ok(Number.isFinite(store.metrics.bird.peakDb))
})
