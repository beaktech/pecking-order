import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { acquireWorkspaceLock } from '../src/workspace-lock.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pecking-order-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('one workspace has one owner, while separate workspaces can run together', async t => {
  const root = await fixture(t)
  const release = acquireWorkspaceLock(root)
  const other = acquireWorkspaceLock(join(root, 'another'))
  try { assert.throws(() => acquireWorkspaceLock(root), /already running/) }
  finally { release(); other() }
  acquireWorkspaceLock(root)()
})

test('a killed owner is recovered, including when normal exit handlers cannot run', async t => {
  const root = await fixture(t)
  const module = new URL('../src/workspace-lock.js', import.meta.url).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireWorkspaceLock } from ${JSON.stringify(module)}; acquireWorkspaceLock(process.argv[1]); process.send('locked'); setInterval(() => {}, 1000)`, root], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  const exited = once(child, 'exit')
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill(); await exited })
  await once(child, 'message')
  assert.throws(() => acquireWorkspaceLock(root), /already running/)
  child.kill('SIGKILL')
  await exited
  const release = acquireWorkspaceLock(root)
  assert.equal(JSON.parse(await readFile(join(root, 'data/workspace.lock'), 'utf8')).pid, process.pid)
  release()
})

test('unknown or foreign owners fail safely, and releasing does not remove another owner', async t => {
  const root = await fixture(t)
  const release = acquireWorkspaceLock(root)
  const path = join(root, 'data/workspace.lock')
  await writeFile(path, '{incomplete')
  assert.throws(() => acquireWorkspaceLock(root), /Cannot safely recover/)
  await writeFile(path, JSON.stringify({ pid: process.pid, hostname: 'another-computer.invalid' }))
  assert.throws(() => acquireWorkspaceLock(root), /Cannot safely recover/)
  release()
  assert.match(await readFile(path, 'utf8'), /another-computer/)
})
