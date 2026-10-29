import { closeSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

// Exclusive creation serialises starts. Stale-lock recovery has its own guard so
// two processes cannot both remove the old lock and become the workspace owner.
export function acquireWorkspaceLock(workspaceRoot) {
  const directory = resolve(workspaceRoot, 'data')
  const path = join(directory, 'workspace.lock')
  const recovery = `${path}.recovery`
  mkdirSync(directory, { recursive: true })
  const owner = JSON.stringify({ pid: process.pid, hostname: hostname(), token: randomUUID() })
  const busy = message => new Error(`${message} Workspace: ${resolve(workspaceRoot)}. Close the other Pecking Order process, or use a different review folder.`)
  const manual = () => new Error(`Cannot safely recover the workspace lock: ${path}. After confirming that no Pecking Order process is using this review folder, remove that lock file and any ${recovery} directory, then try again.`)
  function create() {
    const descriptor = openSync(path, 'wx', 0o600)
    try { writeFileSync(descriptor, owner) }
    catch (error) { unlinkSync(path); throw error }
    finally { closeSync(descriptor) }
  }
  try { create() }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    try { mkdirSync(recovery) }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error(`Another workspace startup or recovery is in progress. Try again shortly. If this persists after every process has stopped, remove ${recovery}.`)
      throw error
    }
    try {
      let previous
      try { previous = JSON.parse(readFileSync(path, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw manual() }
      if (previous !== undefined) {
        if (previous.hostname !== hostname() || !Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw manual()
        let alive = true
        try { process.kill(previous.pid, 0) }
        catch (error) { if (error.code === 'ESRCH') alive = false; else throw busy('The workspace owner could not be checked.') }
        if (alive) throw busy(`Pecking Order is already running here (process ${previous.pid}).`)
        unlinkSync(path)
      }
      try { create() }
      catch (error) { if (error.code === 'EEXIST') throw busy('Another Pecking Order process started in this workspace.'); throw error }
    } finally { rmSync(recovery, { recursive: true, force: true }) }
  }
  return () => {
    try {
      // Never remove a replacement lock if the file was manually changed.
      if (readFileSync(path, 'utf8') === owner) unlinkSync(path)
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`Could not release workspace lock ${path}: ${error.message}`)
    }
  }
}
