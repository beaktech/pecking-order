import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { exportSelections } from './export.js'
import { revealFile } from './platform.js'

const execFileAsync = promisify(execFile)
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' }

export function createAppServer({ config, getLibrary, rescan, analyser, store, reveal = revealFile }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
        const library = getLibrary()
        return json(response, 200, { ...library.summary(), reviews: Object.fromEntries(Object.entries(store.reviews).filter(([id]) => library.get(id))) })
      }
      if (url.pathname === '/api/scan' && request.method === 'POST') {
        const library = await rescan()
        return json(response, 200, library.summary())
      }
      if (url.pathname === '/api/search' && request.method === 'POST') {
        const criteria = await body(request)
        const library = getLibrary()
        const candidates = library.findCandidates(criteria)
        return json(response, 200, candidates.map((clip) => presentClip(clip, library, store, config)))
      }
      if (url.pathname.startsWith('/api/analyse/') && request.method === 'POST') {
        const id = url.pathname.split('/').at(-1)
        const clip = getLibrary().get(id)
        if (!clip) return json(response, 404, { error: 'Recording not found' })
        const analysed = await analyser.analyse(clip)
        return json(response, 200, presentClip(analysed, getLibrary(), store, config))
      }
      if (url.pathname.startsWith('/api/reveal/') && request.method === 'POST') {
        const id = url.pathname.split('/').at(-1)
        const clip = getLibrary().get(id)
        if (!clip) return json(response, 404, { error: 'Recording not found' })
        return json(response, 200, await reveal(clip.path))
      }
      if (url.pathname.startsWith('/api/reviews/') && request.method === 'PATCH') {
        const id = url.pathname.split('/').at(-1)
        if (!getLibrary().get(id)) return json(response, 404, { error: 'Recording not found' })
        const review = store.updateReview(id, await body(request))
        await store.save()
        return json(response, 200, review)
      }
      if (url.pathname === '/api/export' && request.method === 'POST') {
        const { ids } = await body(request)
        const result = await exportSelections({ ids: ids || [], library: getLibrary(), store, config })
        return json(response, 200, result)
      }
      if (url.pathname.startsWith('/media/') && request.method === 'GET') {
        const clip = getLibrary().get(url.pathname.split('/').at(-1))
        if (!clip) return json(response, 404, { error: 'Recording not found' })
        return await streamAudio(request, response, clip.path)
      }
      if (url.pathname.startsWith('/spectrogram/') && request.method === 'GET') {
        const clip = getLibrary().get(url.pathname.split('/').at(-1))
        if (!clip) return json(response, 404, { error: 'Recording not found' })
        const path = await spectrogram(clip, config.dataRoot)
        response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' })
        return await pipeline(createReadStream(path), response)
      }
      return await staticFile(response, config.projectRoot, url.pathname)
    } catch (error) {
      console.error(error)
      if (response.headersSent || response.destroyed) return response.destroy()
      return json(response, 500, { error: error.message })
    }
  })
}

function presentClip(clip, library, store, config) {
  const station = library.station()
  const review = store.reviews[clip.id] || {}
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(clip.timestamp))
  return {
    id: clip.id,
    stationName: station.name || 'My station',
    scientificName: clip.scientificName,
    commonName: clip.commonName,
    confidence: clip.confidence,
    timestamp: clip.timestamp,
    localTime: local,
    filename: clip.relPath,
    analysis: clip.analysis || store.metrics[clip.id] || null,
    review,
    defaults: {
      commonName: clip.commonName,
      location: station.location || station.name || '', latitude: station.latitude ?? '',
      longitude: station.longitude ?? '', elevation: station.elevation ?? '',
      device: station.device || '', microphone: station.microphone || '',
    },
  }
}

async function spectrogram(clip, dataRoot) {
  const directory = join(dataRoot, 'spectrograms')
  const output = join(directory, `${clip.id}.png`)
  try {
    await stat(output)
    return output
  } catch {}
  await mkdir(directory, { recursive: true })
  await execFileAsync('ffmpeg', [
    '-v', 'error', '-y', '-i', clip.path,
    '-lavfi', 'showspectrumpic=s=1200x360:legend=disabled:color=fiery:scale=log:gain=3',
    '-frames:v', '1', output,
  ])
  return output
}

async function streamAudio(request, response, path) {
  const info = await stat(path)
  const range = request.headers.range
  const type = audioType(extname(path))
  if (!range) {
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Accept-Ranges': 'bytes' })
    return await pipeline(createReadStream(path), response)
  }
  const bounds = parseByteRange(range, info.size)
  if (!bounds) {
    response.writeHead(416, { 'Content-Range': `bytes */${info.size}` })
    return response.end()
  }
  const { start, end } = bounds
  response.writeHead(206, {
    'Content-Type': type, 'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Accept-Ranges': 'bytes',
  })
  return await pipeline(createReadStream(path, { start, end }), response)
}

// Safari uses byte ranges to seek. Support one explicit, open-ended or suffix range.
export function parseByteRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2]) || size === 0) return null
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null
  return { start, end }
}

async function staticFile(response, projectRoot, pathname) {
  const wanted = pathname === '/' ? 'index.html' : pathname.slice(1)
  const safe = normalize(wanted).replace(/^(\.\.[/\\])+/, '')
  const path = join(projectRoot, 'public', safe)
  try {
    const content = await readFile(path)
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' })
    response.end(content)
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'Not found' })
    throw error
  }
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

function audioType(extension) {
  return ({ '.flac': 'audio/flac', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4' })[extension.toLowerCase()] || 'application/octet-stream'
}
