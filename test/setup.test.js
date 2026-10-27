import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig } from '../src/config.js'
import { discoverStationMetadata, parseStationCoordinates } from '../src/station-config.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-setup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(resolve('config'), join(root, 'config'), { recursive: true })
  const archive = join(root, 'station', 'clips')
  await mkdir(archive, { recursive: true })
  return { root, archive, path: join(root, 'config/station.local.json') }
}

test('review workspace persists across package locations without writing into either package', async (t) => {
  const { root, archive } = await fixture(t)
  const workspaceRoot = join(root, 'my reviews')
  const packages = [join(root, 'package-one'), join(root, 'package-two')]
  for (const packageRoot of packages) await cp(resolve('config'), join(packageRoot, 'config'), { recursive: true })
  const first = await loadConfig(undefined, { projectRoot: packages[0], workspaceRoot, archive, sourceTimezone: 'UTC', env: {} })
  assert.equal(first.path, join(workspaceRoot, 'config/station.local.json'))
  assert.equal(first.dataRoot, join(workspaceRoot, 'data'))
  assert.equal(first.exportRoot, join(workspaceRoot, 'exports'))
  await mkdir(first.dataRoot)
  await writeFile(join(first.dataRoot, 'state.json'), '{"reviews":{"example":{"decision":"keep"}}}')
  const second = await loadConfig(undefined, { projectRoot: packages[1], workspaceRoot, env: {} })
  assert.equal(second.projectRoot, packages[1])
  assert.equal(second.archiveRoot, first.archiveRoot)
  assert.equal(second.dataRoot, first.dataRoot)
  assert.equal(await readFile(join(second.dataRoot, 'state.json'), 'utf8'), '{"reviews":{"example":{"decision":"keep"}}}')
  for (const packageRoot of packages) await assert.rejects(readFile(join(packageRoot, 'config/station.local.json')), { code: 'ENOENT' })
})

test('first run saves CLI choices and nearby Go coordinates for subsequent starts', async (t) => {
  const { root, archive, path } = await fixture(t)
  const native = join(root, 'station/config.yaml')
  await writeFile(native, 'logging:\n  timezone: America/New_York\nbirdnet:\n  latitude: 12.25 # synthetic\n  longitude: -34.5\n')
  const loaded = await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {}, archive, sourceTimezone: 'UTC' })
  assert.equal(loaded.station.latitude, 12.25)
  assert.equal(loaded.station.longitude, -34.5)
  assert.equal(loaded.sourceTimezone, 'UTC')
  assert.equal(loaded.stationConfigPath, native)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.archiveRoot, archive)
  assert.equal(saved.sourceTimezone, 'UTC')
  assert.equal(saved.country, '')
  assert.equal(saved.projectRoot, undefined)
  assert.deepEqual((await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {} })).station, loaded.station)
})

test('first-run Pi setup uses its own template and reads only literal config coordinates', { skip: process.platform === 'win32' && 'Native Pi setup requires WSL; covered on Linux/macOS.' }, async (t) => {
  const { root, archive, path } = await fixture(t)
  const native = join(root, 'birdnet.conf')
  await writeFile(native, '# Synthetic\nLATITUDE="-12.5"\nLONGITUDE=34.25 # east\nEXTRACTED=$HOME/BirdSongs/Extracted\n')
  const database = join(root, 'birds.db')
  const loaded = await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {}, source: 'birdnet-pi', archive, database, sourceTimezone: 'Asia/Kolkata', stationConfig: native })
  assert.equal(loaded.station.latitude, -12.5)
  assert.equal(loaded.station.longitude, 34.25)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.source, 'birdnet-pi')
  assert.equal(saved.databasePath, database)
  assert.equal(saved.stationConfigPath, native)
  assert.equal((await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {} })).source, 'birdnet-pi')
})

test('unknown recording time zone leaves useful first-run config and asks for explicit confirmation', async (t) => {
  const { root, archive, path } = await fixture(t)
  await writeFile(join(root, 'station/config.yaml'), 'logging:\n  timezone: UTC\nbirdnet:\n  latitude: 0\n  longitude: 0\n')
  await assert.rejects(loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {}, archive }), /Confirm.*sourceTimezone/)
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.sourceTimezone, '')
  assert.equal(saved.station.latitude, 0)
  assert.equal(saved.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone)
})

test('existing configuration is not rewritten and manual coordinates including zero take precedence', async (t) => {
  const { root, archive, path } = await fixture(t)
  const native = join(root, 'station/config.yaml')
  await writeFile(native, 'birdnet:\n  latitude: 20\n  longitude: 30\n')
  const original = JSON.stringify({ source: 'birdnet-go', archiveRoot: archive, sourceTimezone: 'UTC', stationConfigPath: native, station: { name: 'My chosen name', latitude: 0, longitude: -1 } })
  await writeFile(path, original)
  const loaded = await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {} })
  assert.deepEqual(loaded.station, { name: 'My chosen name', latitude: 0, longitude: -1 })
  assert.equal(await readFile(path, 'utf8'), original)
  assert.match(await readFile(native, 'utf8'), /latitude: 20/)
})

test('relative native config paths resolve beside explicit JSON config, CLI paths from cwd', async (t) => {
  const { root, archive, path } = await fixture(t)
  await writeFile(join(root, 'config/native.yaml'), 'birdnet:\n  latitude: 10\n  longitude: 11\n')
  await writeFile(path, JSON.stringify({ source: 'birdnet-go', archiveRoot: archive, sourceTimezone: 'UTC', stationConfigPath: 'native.yaml' }))
  assert.equal((await loadConfig(path, { env: {} })).station.latitude, 10)
  await assert.rejects(loadConfig(path, { env: {}, stationConfig: 'missing-native.yaml' }), (error) => error.message.includes(resolve('missing-native.yaml')))
})

test('optional Go database discovery stays beside the selected archive', async (t) => {
  const { root, archive } = await fixture(t)
  const database = join(root, 'station/birdnet.db')
  await writeFile(database, '') // Config discovery checks the path; the reader validates SQLite.
  const loaded = await loadConfig(undefined, { projectRoot: root, workspaceRoot: root, env: {}, archive, sourceTimezone: 'UTC' })
  assert.equal(loaded.databasePath, database)
})

test('Go YAML coordinates accept quoted literals and ignore unrelated nested coordinates', () => {
  const parsed = parseStationCoordinates('birdnet-go', 'birdnet:\n  latitude: "0"\n  longitude: \'12.5\' # note\n  unrelated:\n    latitude: 80\n    longitude: 160\nother:\n  latitude: 70\n')
  assert.deepEqual(parsed.station, { latitude: 0, longitude: 12.5 })
  assert.deepEqual(parsed.warnings, [])
})

test('config parsing rejects expressions, out-of-range values and ambiguous duplicates', () => {
  for (const source of ['birdnet-go', 'birdnet-pi']) {
    const content = source === 'birdnet-go' ? 'birdnet:\n  latitude: !!float 20\n  longitude: 200\n' : 'LATITUDE=$(touch /tmp/never-execute)\nLONGITUDE=200\n'
    const result = parseStationCoordinates(source, content)
    assert.deepEqual(result.station, {})
    assert.equal(result.warnings.length, 2)
  }
  assert.throws(() => parseStationCoordinates('birdnet-pi', 'LATITUDE=1\nLATITUDE=2'), /Duplicate latitude/)
  const values = parseStationCoordinates('birdnet-pi', 'LATITUDE=$LATITUDE\nLONGITUDE=`echo 10`\n')
  assert.deepEqual(values.station, {})
})

test('native config contents cannot execute shell commands', async (t) => {
  const { root, archive } = await fixture(t)
  const sentinel = join(root, 'must-not-exist')
  const native = join(root, 'birdnet.conf')
  await writeFile(native, `LATITUDE=$(touch '${sentinel}')\nLONGITUDE=0\nsource evil.sh\n`)
  const metadata = await discoverStationMetadata('birdnet-pi', native, archive)
  assert.equal(metadata.station.latitude, undefined)
  assert.equal(metadata.station.longitude, 0)
  assert.equal(metadata.warnings.length, 1)
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' })
})
