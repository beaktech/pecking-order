#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { AudioAnalyser } from './analyse.js'
import { loadConfig } from './config.js'
import { loadLibraryCache, saveLibraryCache, scanLibrary } from './library.js'
import { createAppServer } from './server.js'
import { Store } from './store.js'
import { checkAudioTools, openBrowser } from './platform.js'

async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('Node.js 22.13 or newer is required, including built-in SQLite support.')
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4317' }, config: { type: 'string' }, archive: { type: 'string' },
      'station-config': { type: 'string' }, source: { type: 'string' }, database: { type: 'string' }, 'source-timezone': { type: 'string' },
      'no-open': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    console.log('Usage: pecking-order [--source birdnet-go|birdnet-pi] [--archive PATH] [--source-timezone ZONE] [--station-config PATH] [--database PATH] [--config PATH] [--port 4317] [--no-open]')
    console.log('Archive path: --archive overrides PECKING_ORDER_ARCHIVE, which overrides config archiveRoot.')
    console.log('Run from your review folder: config/station.local.json, data/ and exports/ are saved there, outside the installed package.')
    console.log('BirdNET-Pi requires its BirdNET-Pi/scripts/birds.db SQLite database, opened read-only.')
    return
  }
  const config = await loadConfig(values.config, {
    archive: values.archive, source: values.source, database: values.database, sourceTimezone: values['source-timezone'], stationConfig: values['station-config'],
  })
  for (const warning of config.setupWarnings) console.warn(warning)
  await checkAudioTools()
  const store = await new Store(config.dataRoot).load()
  let library
  function reportWarnings() {
    for (const warning of library.warnings) console.warn(warning.message || `${warning.reason}: ${warning.count}. Examples: ${warning.examples.join(', ')}`)
  }
  async function rescan() {
    console.log(`Scanning ${config.archiveRoot}...`)
    const scanned = await scanLibrary(config)
    await saveLibraryCache(scanned, config)
    library = scanned
    console.log(`Indexed ${library.clips.length.toLocaleString()} clips across ${library.species.length.toLocaleString()} species.`)
    reportWarnings()
    return library
  }
  library = await loadLibraryCache(config)
  if (library) {
    console.log(`Loaded ${library.clips.length.toLocaleString()} indexed clips across ${library.species.length.toLocaleString()} species.`)
    reportWarnings()
  } else await rescan()
  const analyser = new AudioAnalyser(store)
  const server = createAppServer({ config, getLibrary: () => library, rescan, analyser, store })
  const port = Number(values.port)
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use, perhaps by another Pecking Order window. Close it, or choose another port with --port ${port + 1}.` : error.message)
    process.exitCode = 1
  })
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`
    console.log(`Pecking Order is ready at ${url}`)
    if (!values['no-open']) void openBrowser(url).then((opened) => {
      if (!opened) console.log(`Open ${url} in your browser.`)
    })
  })
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
