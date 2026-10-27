import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('SQLite warning is hidden while other experimental and deprecation warnings remain visible', async () => {
  const { stderr, stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
    import { loadSqlite } from './src/sqlite.js'
    const original = process.emitWarning
    const pending = loadSqlite()
    process.emitWarning('Unrelated feature during import', 'ExperimentalWarning')
    const [first, second] = await Promise.all([pending, loadSqlite()])
    if (first !== second || process.emitWarning !== original) throw new Error('Warning handler was not restored')
    const db = new first.DatabaseSync(':memory:')
    db.close()
    process.emitWarning('Another feature', 'ExperimentalWarning')
    process.emitWarning('Deprecated feature', 'DeprecationWarning')
    console.log('ok')
  `])
  assert.equal(stdout.trim(), 'ok')
  assert.doesNotMatch(stderr, /SQLite is an experimental feature/)
  assert.match(stderr, /ExperimentalWarning: Unrelated feature during import/)
  assert.match(stderr, /ExperimentalWarning: Another feature/)
  assert.match(stderr, /DeprecationWarning: Deprecated feature/)
})
