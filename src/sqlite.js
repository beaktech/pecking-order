let sqlitePromise

// Node 22 warns on first import. Hide only this known SQLite warning, leaving
// deprecation warnings and all other experimental-feature warnings untouched.
export function loadSqlite() {
  sqlitePromise ??= importSqlite()
  return sqlitePromise
}

async function importSqlite() {
  const emitWarning = process.emitWarning
  process.emitWarning = function (warning, type, ...args) {
    const name = typeof type === 'object' ? type?.type : type
    if (warning === 'SQLite is an experimental feature and might change at any time' && name === 'ExperimentalWarning') return
    return emitWarning.call(this, warning, type, ...args)
  }
  try {
    return await import('node:sqlite')
  } finally {
    process.emitWarning = emitWarning
  }
}
