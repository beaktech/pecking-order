import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadConfig } from '../src/config.js'

const execFileAsync = promisify(execFile)
const nativePi = { skip: process.platform === 'win32' && 'Native Pi setup requires WSL; Windows rejection is tested separately.' }

async function fixture(t, values = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'config.json')
  await writeFile(path, JSON.stringify({ source: 'birdnet-go', sourceTimezone: 'UTC', archiveRoot: './recordings', station: { name: 'Garden' }, ...values }))
  return { root, path }
}

test('one-station config resolves paths beside the config and uses neutral defaults', async (t) => {
  const { root, path } = await fixture(t, { labelsPath: './labels.txt' })
  const config = await loadConfig(path, { env: {} })
  assert.equal(config.source, 'birdnet-go')
  assert.equal(config.archiveRoot, join(root, 'recordings'))
  assert.equal(config.labelsPath, join(root, 'labels.txt'))
  assert.equal(config.country, '')
  assert.equal(config.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone)
  assert.deepEqual(config.station, { name: 'Garden' })
  assert.equal(config.monitors, undefined)
})

test('archive flag overrides environment, which overrides config; overrides use the working directory', async (t) => {
  const { path } = await fixture(t)
  const env = { PECKING_ORDER_ARCHIVE: './environment recordings' }
  assert.equal((await loadConfig(path, { env })).archiveRoot, resolve('environment recordings'))
  const config = await loadConfig(path, { env, archive: './flag recordings' })
  assert.equal(config.archiveRoot, resolve('flag recordings'))
})

test('source, database and station time zone have explicit CLI overrides', nativePi, async (t) => {
  const { root, path } = await fixture(t, { source: 'birdnet-pi', databasePath: './birds.db' })
  assert.equal((await loadConfig(path, { env: {} })).databasePath, join(root, 'birds.db'))
  const config = await loadConfig(path, { env: {}, database: './override.db', sourceTimezone: 'Europe/London' })
  assert.equal(config.databasePath, resolve('override.db'))
  assert.equal(config.sourceTimezone, 'Europe/London')
  assert.equal((await loadConfig(path, { env: {}, source: 'birdnet-go' })).databasePath, undefined)
})

test('missing archive explains all three ways to configure it', async (t) => {
  const { path } = await fixture(t, { archiveRoot: '' })
  await assert.rejects(loadConfig(path, { env: {} }), /archiveRoot.*PECKING_ORDER_ARCHIVE.*--archive PATH/)
})

test('BirdNET-Pi requires its SQLite database and names the expected file', nativePi, async (t) => {
  const { path } = await fixture(t, { source: 'birdnet-pi' })
  await assert.rejects(loadConfig(path, { env: {} }), /BirdNET-Pi\/scripts\/birds.db.*BirdDB.txt is not supported/)
})

test('requires a known source time zone independently from the display zone', async (t) => {
  for (const values of [{ sourceTimezone: '' }, { sourceTimezone: 'Not/AZone' }, { timezone: 'Not/AZone' }]) {
    const { path } = await fixture(t, values)
    await assert.rejects(loadConfig(path, { env: {} }), /sourceTimezone|Unknown time zone/)
  }
  const { path } = await fixture(t, { sourceTimezone: 'Asia/Kolkata', timezone: 'America/New_York' })
  const config = await loadConfig(path, { env: {} })
  assert.equal(config.sourceTimezone, 'Asia/Kolkata')
  assert.equal(config.timezone, 'America/New_York')
})

test('rejects custom archive configs and invalid source or station settings', async (t) => {
  for (const values of [{ source: 'backup' }, { archiveMode: 'clips' }, { monitors: [] }, { station: [] }, { station: null }]) {
    const { path } = await fixture(t, values)
    await assert.rejects(loadConfig(path, { env: {} }))
  }
})

test('CLI reports missing archive without starting the server or printing a stack trace', async (t) => {
  const { path } = await fixture(t, { archiveRoot: '' })
  const env = { ...process.env }
  delete env.PECKING_ORDER_ARCHIVE
  await assert.rejects(execFileAsync(process.execPath, ['src/cli.js', '--config', path, '--no-open'], { env }), (error) => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /No recording archive configured/)
    assert.match(error.stderr, /--archive PATH/)
    assert.doesNotMatch(error.stderr, /at loadConfig/)
    assert.equal(error.stdout, '')
    return true
  })
})

test('CLI help documents both sources, time zones and the required Pi database', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['src/cli.js', '--help'])
  assert.match(stdout, /--source birdnet-go\|birdnet-pi/)
  assert.match(stdout, /--source-timezone ZONE/)
  assert.match(stdout, /BirdNET-Pi\/scripts\/birds.db.*read-only/)
  assert.doesNotMatch(stdout, /archive-mode|backup|monitor/)
})

// Exercise the real setup guard on Windows, not only command-selection mocks.
test('native Windows rejects Pi setup with the WSL route', { skip: process.platform !== 'win32' }, async (t) => {
  const { path } = await fixture(t, { source: 'birdnet-pi' })
  await assert.rejects(loadConfig(path, { env: {} }), /filenames contain colons.*WSL.*Linux filesystem/)
})
