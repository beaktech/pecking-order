import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { loadSqlite } from '../src/sqlite.js'

const execFileAsync = promisify(execFile)
const { DatabaseSync } = await loadSqlite()

async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = join(root, 'app')
  await mkdir(app)
  for (const name of ['src', 'public', 'config', 'package.json']) await cp(resolve(name), join(app, name), { recursive: true })
  const archive = join(root, 'Bird recordings, garden & café')
  const filename = source === 'birdnet-go' ? 'parus_major_90p_20260515T120000Z_15s.wav' : 'Great_Tit-90-2026-05-15-birdnet-12:00:00.wav'
  const folder = source === 'birdnet-go' ? join(archive, '2026', '05') : join(archive, 'By_Date', '2026-05-15', 'Great_Tit')
  await mkdir(folder, { recursive: true })
  await execFileAsync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', join(folder, filename)])
  const args = ['--source', source, '--archive', archive, '--source-timezone', 'UTC']
  const databasePath = join(root, 'birds.db')
  if (source === 'birdnet-pi') {
    const db = new DatabaseSync(databasePath)
    db.exec('CREATE TABLE detections (Date TEXT, Time TEXT, Sci_Name TEXT, Com_Name TEXT, Confidence REAL, File_Name TEXT)')
    db.prepare('INSERT INTO detections VALUES (?, ?, ?, ?, ?, ?)').run('2026-05-15', '12:00:00', 'Parus major', 'Great Tit', 0.9, filename)
    db.close()
    args.push('--database', databasePath)
  }
  return { app, args, databasePath }
}

async function start(t, app, args) {
  const env = { ...process.env }
  delete env.PECKING_ORDER_ARCHIVE
  const child = spawn(process.execPath, ['src/cli.js', '--no-open', '--port', '0', ...args], { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  const exit = new Promise((resolve) => child.once('exit', resolve))
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exit
  }
  t.after(stop)
  child.stderr.on('data', (data) => { stderr += data })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stdout} ${stderr}`)), 10000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${stdout} ${stderr}`)) })
    child.stdout.on('data', (data) => {
      stdout += data
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/)
      if (match) { clearTimeout(timer); resolve(match[0]) }
    })
  })
  return { url, stop, logs: () => ({ stdout, stderr }) }
}

for (const source of ['birdnet-go', 'birdnet-pi']) {
  test(`${source}: CLI startup, review, analysis, export and cached restart`, { skip: source === 'birdnet-pi' && process.platform === 'win32' && 'Native Pi filenames require WSL; covered on Linux/macOS.' }, async (t) => {
    const { app, args, databasePath } = await fixture(t, source)
    const running = await start(t, app, args)
    const request = async (path, method, body) => {
      const response = await fetch(running.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    const summary = await request('/api/bootstrap', 'GET')
    assert.equal(summary.clipCount, 1)
    assert.equal(summary.source, source)
    assert.equal(summary.station.name, 'My station')
    assert.equal(summary.monitors, undefined)
    const config = JSON.parse(await readFile(join(app, 'config/station.local.json'), 'utf8'))
    assert.equal(config.station.name, 'My station')
    assert.equal(config.source, source)
    assert.equal(config.sourceTimezone, 'UTC')
    const html = await (await fetch(running.url)).text()
    assert.doesNotMatch(html, /monitorSelect|All monitors/)
    const [clip] = await request('/api/search', 'POST', { species: 'parus_major' })
    assert.equal(clip.stationName, 'My station')
    assert.equal(clip.timestamp, '2026-05-15T12:00:00.000Z')
    const media = await fetch(running.url + '/media/' + clip.id)
    assert.equal(Buffer.from(await media.arrayBuffer()).subarray(0, 4).toString(), 'RIFF')
    const analysed = await request('/api/analyse/' + clip.id, 'POST', {})
    assert.ok(Number.isFinite(analysed.analysis.score))
    await request('/api/reviews/' + clip.id, 'PATCH', { decision: 'keep', confirmed: true, location: 'Public garden' })
    const exported = await request('/api/export', 'POST', { ids: [clip.id] })
    const csv = await readFile(join(exported.outputDir, 'xeno-canto-metadata.csv'), 'utf8')
    assert.match(csv, /Parus major/)
    assert.match(csv, /Public garden/)
    assert.doesNotMatch(csv, /undefined|BirdNET-Go recording/)
    await running.stop()
    assert.doesNotMatch(running.logs().stderr, /ExperimentalWarning|Error/)
    const restarted = await start(t, app, [])
    assert.match(restarted.logs().stdout, /Loaded 1 indexed clips/)
    const restored = await (await fetch(restarted.url + '/api/bootstrap')).json()
    assert.equal(restored.reviews[clip.id].confirmed, true)
    await restarted.stop()
    if (source === 'birdnet-pi') {
      await rm(databasePath)
      await assert.rejects(execFileAsync(process.execPath, ['src/cli.js', '--no-open', ...args], { cwd: app }), (error) => {
        assert.equal(error.code, 1)
        assert.ok(error.stderr.includes(databasePath))
        assert.match(error.stderr, /Expected BirdNET-Pi\/scripts\/birds.db/)
        assert.doesNotMatch(error.stderr, /ExperimentalWarning|at readPiDatabase/)
        return true
      })
    }
  })
}

test('CLI fails before scanning when audio tools are absent, while help remains available', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'config.json')
  await writeFile(config, JSON.stringify({ source: 'birdnet-go', archiveRoot: join(root, 'missing archive'), sourceTimezone: 'UTC' }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
  env.PATH = root
  delete env.PECKING_ORDER_ARCHIVE
  await assert.rejects(execFileAsync(process.execPath, ['src/cli.js', '--config', config, '--no-open'], { env }), (error) => {
    assert.equal(error.code, 1)
    assert.match(error.stderr, /Required audio tools could not run: ffmpeg, ffprobe/)
    assert.doesNotMatch(error.stdout, /Scanning|ready at/)
    assert.doesNotMatch(error.stderr, /at checkAudioTools/)
    return true
  })
  const help = await execFileAsync(process.execPath, ['src/cli.js', '--help'], { env })
  assert.match(help.stdout, /Usage:/)
  assert.equal(help.stderr, '')
})
