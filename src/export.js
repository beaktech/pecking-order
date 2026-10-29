import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

import { localDateTime, recordingMetadata, stationDefaults } from './preparation.js'
export { localDateTime } from './preparation.js'

const execFileAsync = promisify(execFile)

export async function exportSelections({ ids, library, store, config }) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) throw new Error('Choose recording IDs to export')
  const clips = [...new Set(ids)].map((id) => {
    const clip = library.get(id)
    if (!clip) throw new Error(`Selected recording is no longer indexed: ${id}. Rescan the archive before exporting.`)
    return clip
  })
  if (!clips.length) throw new Error('No recordings selected')

  const reviews = {}
  for (const clip of clips) {
    const review = store.reviews[clip.id]
    if (!review || review.decision !== 'keep' || review.confirmed !== true) {
      throw new Error('Every exported recording must be kept and have its identification confirmed')
    }
    reviews[clip.id] = { ...review }
  }

  const defaults = stationDefaults(config, library, store)
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  await mkdir(config.exportRoot, { recursive: true })
  const stagingDir = await mkdtemp(join(config.exportRoot, `.xeno-canto-${timestamp}-`))
  const outputDir = join(config.exportRoot, basename(stagingDir).slice(1))
  // Publish only after every WAV and its metadata are complete. A failed
  // conversion must not leave an apparently finished export in the folder.
  try {
    const rows = []

    for (const clip of clips) {
      const review = reviews[clip.id]
      const local = localDateTime(clip.timestamp, config.timezone)
      const outputName = `${clip.slug.replace(/[^a-z0-9_-]/gi, '_')}_${local.date}_${local.time.replace(':', '')}_${clip.id}.wav`
      const outputPath = join(stagingDir, outputName)
      await execFileAsync('ffmpeg', ['-v', 'error', '-n', '-i', clip.path, '-map_metadata', '0', '-c:a', 'pcm_s24le', outputPath])

      rows.push({
        file: outputName,
        ...recordingMetadata(clip, review, defaults, config),
        birdnet_confidence_percent: clip.confidence,
        quality_score: store.metrics[clip.id]?.score ?? '',
        original_file: clip.path,
      })
    }

    await writeFile(join(stagingDir, 'xeno-canto-metadata.csv'), toCsv(rows))
    await writeFile(join(stagingDir, 'README.txt'), exportNotes(rows.length))
    await rename(stagingDir, outputDir)
    return { outputDir, count: rows.length }
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export function toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const quote = (value) => {
    let text = String(value ?? '')
    // CSV quoting only escapes delimiters: spreadsheets still evaluate formulas.
    // Preserve signed numbers (coordinates and measurements) as numbers.
    const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())
    if (!number && /^(?:[\t\r\n]|\s*[=+@-])/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return `${headers.map(quote).join(',')}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(',')).join('\n')}\n`
}

function exportNotes(count) {
  return `Pecking Order — Xeno-canto preparation export\n\n${count} lossless WAV recording(s) are included. The archive originals were not modified.\n\nBefore uploading:\n- Listen to each complete recording again.\n- Confirm the identification against current IOC taxonomy.\n- Check foreground and background species.\n- Check the public location name and verify coordinates.\n- Describe any filtering or other processing truthfully. These WAV files were decoded from the source recordings without filtering. Converting a lossy source (such as MP3) to WAV does not restore lost detail.\n- Choose your Xeno-canto licence during upload.\n\nThe CSV is a preparation manifest, not an automated upload or a verified Xeno-canto batch template. Formula-like text is prefixed with an apostrophe to prevent spreadsheet evaluation. Blank fields still need checking before submission. Choose the sharing licence on Xeno-canto.\n`
}
