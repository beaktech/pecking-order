import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

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
      const station = library.station()
      const local = localDateTime(clip.timestamp, config.timezone)
      const outputName = `${clip.slug.replace(/[^a-z0-9_-]/gi, '_')}_${local.date}_${local.time.replace(':', '')}_${clip.id}.wav`
      const outputPath = join(stagingDir, outputName)
      await execFileAsync('ffmpeg', ['-v', 'error', '-n', '-i', clip.path, '-map_metadata', '0', '-c:a', 'pcm_s24le', outputPath])

      rows.push({
        file: outputName,
        scientific_name: clip.scientificName,
        common_name: review.commonName || clip.commonName || '',
        date: local.date,
        time: local.time,
        country: config.country,
        location: review.location || station.location || station.name || '',
        latitude: review.latitude ?? station.latitude ?? '',
        longitude: review.longitude ?? station.longitude ?? '',
        elevation_m: review.elevation ?? station.elevation ?? '',
        type: review.vocalisationType || 'song',
        background_species: review.backgroundSpecies || '',
        sex: review.sex || '',
        life_stage: review.lifeStage || '',
        animal_seen: review.animalSeen || 'no',
        playback_used: review.playbackUsed || 'no',
        automatic_recording: 'yes',
        device: review.device || station.device || '',
        microphone: review.microphone || station.microphone || '',
        remarks: review.remarks || 'Selected from an autonomous recording; identification manually reviewed.',
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

export function localDateTime(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

export function toCsv(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return `${headers.map(quote).join(',')}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(',')).join('\n')}\n`
}

function exportNotes(count) {
  return `Pecking Order — Xeno-canto preparation export\n\n${count} lossless WAV recording(s) are included. The archive originals were not modified.\n\nBefore uploading:\n- Listen to each complete recording again.\n- Confirm the identification against current IOC taxonomy.\n- Check foreground and background species.\n- Check the public location name and verify coordinates.\n- Describe any filtering or other processing truthfully. These WAV files were decoded from the source recordings without filtering. Converting a lossy source (such as MP3) to WAV does not restore lost detail.\n- Choose your Xeno-canto licence during upload.\n\nThe CSV is a preparation manifest, not an automated upload.\n`
}
