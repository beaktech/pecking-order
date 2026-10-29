// Run with npm run test:package; all installs and source fixtures stay temporary.
import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { loadSqlite } from '../src/sqlite.js'

const run = promisify(execFile)
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'Run this check with npm run test:package.')
const root = await realpath(await mkdtemp(join(tmpdir(), 'pecking-order-package-')))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
const inheritedPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
env.PATH = `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${inheritedPath}`
delete env.PECKING_ORDER_ARCHIVE

async function start(app, workspace, args = []) {
  const child = spawn(process.execPath, [join(app, 'src/cli.js'), '--no-open', '--port', '0', ...args], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise(resolve => child.once('exit', resolve))
  let stdout = '', stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${stdout} ${stderr}`)), 15000)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error(`Startup failed: ${stdout} ${stderr}`)) })
      child.stdout.on('data', data => {
        stdout += data
        const match = stdout.match(/Pecking Order is ready at (http:\/\/127\.0\.0\.1:\d+)/)
        if (match) { clearTimeout(timer); resolve(match[1]) }
      })
    })
    return { url, stop }
  } catch (error) { await stop(); throw error }
}

try {
  const source = join(root, 'source')
  await mkdir(source)
  for (const name of ['src', 'resources', 'public', 'config', 'docs', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md']) {
    await cp(join(project, name), join(source, name), { recursive: true })
  }
  for (const name of ['config/secret.local.json', 'data/state.json', 'exports/private.wav', '.subroutine', 'PHASE5.md']) {
    await mkdir(dirname(join(source, name)), { recursive: true })
    await writeFile(join(source, name), 'synthetic private-file sentinel')
  }
  const { stdout } = await run(process.execPath, [npmCli, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root, '--cache', join(root, 'pack-cache')], { cwd: source, env })
  const [packed] = JSON.parse(stdout)
  assert.equal(packed.name, 'pecking-order')
  assert.equal(packed.version, '0.1.0')
  const metadata = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  assert.equal(metadata.author, 'Beak Tech Community Interest Company')
  assert.equal(metadata.license, 'MIT')
  assert.deepEqual(Object.keys(metadata.dependencies || {}), [], 'The installed app must not acquire runtime dependencies')
  assert.notEqual(metadata.private, true)
  assert.match(await readFile(join(source, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 Beak Tech Community Interest Company/)
  const paths = new Set(packed.files.map(file => file.path))
  for (const required of ['LICENSE', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'resources/common-names.en.json', 'resources/ATTRIBUTION.md', 'src/cli.js', 'public/index.html', 'public/logo.png', 'docs/screenshot.png', 'docs/birdnet-pi-windows.md', 'config/station.example.json', 'config/birdnet-pi.example.json']) assert.ok(paths.has(required), required)
  for (const path of paths) assert.match(path, /^(?:resources\/(?:common-names\.en\.json|ATTRIBUTION\.md)|src\/[^/]+\.js|public\/[^/]+\.(?:html|css|js|png)|config\/(?:station|birdnet-pi)\.example\.json|docs\/(?:screenshot\.png|birdnet-pi-windows\.md)|package\.json|README\.md|CONTRIBUTING\.md|SECURITY\.md|CODE_OF_CONDUCT\.md|CHANGELOG\.md|LICENSE)$/)
  // Windows has no executable bit to pack; npm exec below still proves the bin runs there.
  if (process.platform !== 'win32') assert.ok(packed.files.find(file => file.path === 'src/cli.js').mode & 0o111, 'CLI must be executable')
  const tarball = join(root, packed.filename)
  const installs = []
  // npm exec is the implementation behind npx. Exercise its real package/bin
  // resolution offline, then run each installed CLI directly so teardown owns
  // the server process on every platform (no orphaned npm/shell child).
  for (let index = 0; index < 2; index++) {
    const cache = join(root, `npm-cache-${index}`)
    const { stdout: help } = await run(process.execPath, [npmCli, 'exec', '--offline', '--yes', '--ignore-scripts', '--cache', cache, '--package', tarball, '--', 'pecking-order', '--help'], { cwd: root, env })
    assert.match(help, /Usage: pecking-order/)
    assert.doesNotMatch(help, /Birdsong|Curator|BIRDSONG/)
    const entries = await readdir(join(cache, '_npx'))
    assert.equal(entries.length, 1)
    installs.push(join(cache, '_npx', entries[0], 'node_modules/pecking-order'))
  }
  const { DatabaseSync } = await loadSqlite()
  for (const sourceType of process.platform === 'win32' ? ['birdnet-go'] : ['birdnet-go', 'birdnet-pi']) {
    const workspace = join(root, `${sourceType} review folder`)
    const archive = join(root, `${sourceType} recordings`)
    const filename = sourceType === 'birdnet-go' ? 'parus_major_90p_20260515T120000Z.wav' : 'Great_Tit-90-2026-05-15-birdnet-12:00:00.wav'
    const folder = sourceType === 'birdnet-go' ? join(archive, '2026', '05') : join(archive, 'By_Date', '2026-05-15', 'Great_Tit')
    await mkdir(workspace)
    await mkdir(folder, { recursive: true })
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', join(folder, filename)])
    const args = ['--source', sourceType, '--archive', archive, '--source-timezone', 'UTC']
    if (sourceType === 'birdnet-pi') {
      const database = join(root, 'birds.db')
      const db = new DatabaseSync(database)
      try {
        db.exec('CREATE TABLE detections (Date TEXT, Time TEXT, Sci_Name TEXT, Com_Name TEXT, Confidence REAL, File_Name TEXT)')
        db.prepare('INSERT INTO detections VALUES (?, ?, ?, ?, ?, ?)').run('2026-05-15', '12:00:00', 'Parus major', 'Great Tit', 0.9, filename)
      } finally { db.close() }
      args.push('--database', database)
    }
    let clipId
    const app = await start(installs[0], workspace, args)
    try {
      async function request(path, method = 'GET', body) {
        const response = await fetch(app.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
        assert.equal(response.status, 200, await response.clone().text())
        return response.json()
      }
      const html = await (await fetch(app.url)).text()
      assert.match(html, /<title>Pecking Order<\/title>/)
      assert.match(html, /class="eyebrow">Beak Tech<\/p>/)
      assert.equal((await request('/api/bootstrap')).clipCount, 1)
      const [clip] = await request('/api/search', 'POST', { species: 'parus_major' })
      assert.equal(clip.commonName, 'Great Tit')
      clipId = clip.id
      assert.ok(Number.isFinite((await request(`/api/analyse/${clipId}`, 'POST', {})).analysis.score))
      await request(`/api/reviews/${clipId}`, 'PATCH', { decision: 'keep', confirmed: true })
      const exported = await request('/api/export', 'POST', { ids: [clipId] })
      assert.equal(dirname(exported.outputDir), join(workspace, 'exports'))
      assert.match(await readFile(join(exported.outputDir, 'README.txt'), 'utf8'), /^Pecking Order — Xeno-canto/)
      assert.ok((await readFile(join(exported.outputDir, 'xeno-canto-metadata.csv'), 'utf8')).includes('Parus major'))
      await readFile(join(workspace, 'config/station.local.json'))
      await readFile(join(workspace, 'data/state.json'))
    } finally { await app.stop() }
    const restarted = await start(installs[1], workspace)
    try {
      const summary = await (await fetch(restarted.url + '/api/bootstrap')).json()
      assert.equal(summary.reviews[clipId].confirmed, true)
    } finally { await restarted.stop() }
    console.log(`${sourceType}: packaged startup, UI, analysis, review, export and restart from a different npm cache passed.`)
  }
  for (const app of installs) {
    for (const path of ['config/station.local.json', 'data', 'exports']) await assert.rejects(readdir(join(app, path)), { code: 'ENOENT' })
  }
  console.log(`Package contents (${paths.size} files), MIT licence, executable bin, offline npx resolution and package-write isolation passed.`)
} finally { await rm(root, { recursive: true, force: true }) }
