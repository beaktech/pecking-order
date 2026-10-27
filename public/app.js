const state = { bootstrap: null, results: [], activeId: null, searchGeneration: 0, sortPending: false, saving: new Set() }

const elements = {
  archiveStatus: byId('archiveStatus'), speciesTotal: byId('speciesTotal'), speciesInput: byId('speciesInput'),
  speciesList: byId('speciesList'), confidenceInput: byId('confidenceInput'),
  confidenceOutput: byId('confidenceOutput'), searchForm: byId('searchForm'), loading: byId('loadingState'),
  empty: byId('emptyState'), grid: byId('recordingGrid'), resultTitle: byId('resultTitle'),
  resultContext: byId('resultContext'), resultCount: byId('resultCount'), rescan: byId('rescanButton'),
  export: byId('exportButton'), dialog: byId('reviewDialog'), reviewForm: byId('reviewForm'), toast: byId('toast'),
}

void bootstrap().catch((error) => showToast(error.message))

elements.confidenceInput.addEventListener('input', () => { elements.confidenceOutput.value = `${elements.confidenceInput.value}%` })
elements.searchForm.addEventListener('submit', search)
elements.rescan.addEventListener('click', rescan)
elements.export.addEventListener('click', exportKept)
byId('closeDialog').addEventListener('click', () => elements.dialog.close())
byId('copyFilePath').addEventListener('click', copyFilePath)
byId('rejectDialog').addEventListener('click', () => saveActive({ decision: 'reject', confirmed: false }, true))
elements.reviewForm.addEventListener('submit', saveReviewForm)
elements.grid.addEventListener('click', handleGridClick)
// Keep one recording audible, and defer ranking changes until listening stops.
elements.grid.addEventListener('play', (event) => {
  for (const audio of elements.grid.querySelectorAll('audio')) {
    if (audio !== event.target) audio.pause()
  }
}, true)
elements.grid.addEventListener('pause', () => {
  if (state.sortPending) queueMicrotask(() => sortAnalysedResults(state.searchGeneration))
}, true)

async function bootstrap() {
  const data = await api('/api/bootstrap')
  state.bootstrap = data
  elements.archiveStatus.textContent = `${formatNumber(data.clipCount)} clips · ${formatNumber(data.speciesCount)} species`
  elements.speciesTotal.textContent = `${formatNumber(data.speciesCount)} species`
  elements.speciesList.innerHTML = data.species.map((species) => `<option value="${escapeHtml(species.commonName || species.scientificName)}">${escapeHtml(species.scientificName)} · ${formatNumber(species.count)} clips</option>`).join('')
  const warnings = data.warnings || []
  byId('importWarnings').hidden = !warnings.length
  byId('importWarningList').innerHTML = warnings.map((item) => `<li>${escapeHtml(item.reason)}: ${formatNumber(item.count)}. ${item.examples.map(escapeHtml).join('; ')}</li>`).join('')
  updateReviewCounts()
}

async function search(event) {
  event.preventDefault()
  if (!state.bootstrap) return showToast('Archive is not ready. Try Rescan.')
  const speciesName = elements.speciesInput.value.trim()
  const species = state.bootstrap.species.find((item) =>
    item.scientificName.toLowerCase() === speciesName.toLowerCase() || item.commonName.toLowerCase() === speciesName.toLowerCase())
  if (!species) return showToast('Choose a species from the archive list.')
  const generation = ++state.searchGeneration
  state.sortPending = false
  for (const audio of elements.grid.querySelectorAll('audio')) audio.pause()
  setLoading(true)
  try {
    const form = new FormData(elements.searchForm)
    const results = await api('/api/search', {
      method: 'POST',
      body: JSON.stringify({
        species: species.slug, from: form.get('from'), to: form.get('to'),
        minConfidence: Number(form.get('minConfidence')), limit: Number(form.get('limit')),
      }),
    })
    if (generation !== state.searchGeneration) return
    state.results = results
    elements.resultTitle.textContent = species.commonName || species.scientificName
    elements.resultContext.textContent = `${species.scientificName} · ${state.bootstrap.station.name || 'My station'}`
    renderResults()
    setLoading(false)
    void analyseResults(generation)
  } catch (error) {
    showToast(error.message)
  } finally {
    if (generation === state.searchGeneration) setLoading(false)
  }
}

async function analyseResults(generation) {
  const pending = state.results.filter((item) => !item.analysis || item.analysis.error)
  if (!pending.length) return sortAnalysedResults(generation)
  let completed = 0
  showAnalysisProgress(completed, pending.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length && generation === state.searchGeneration) {
      const original = pending[cursor++]
      try {
        const analysed = await api(`/api/analyse/${original.id}`, { method: 'POST', body: '{}' })
        if (generation !== state.searchGeneration) return
        const index = state.results.findIndex((item) => item.id === analysed.id)
        if (index >= 0) {
          // Analysis may have started before a keep/reject request finished.
          state.results[index] = { ...analysed, review: state.results[index].review }
          refreshCard(state.results[index])
        }
      } catch (error) {
        if (generation === state.searchGeneration) showToast(error.message)
      } finally {
        completed++
        if (generation === state.searchGeneration) showAnalysisProgress(completed, pending.length)
      }
    }
  })
  await Promise.all(workers)
  sortAnalysedResults(generation)
}

function showAnalysisProgress(completed, total) {
  elements.resultCount.textContent = completed < total
    ? `Analysing ${completed} of ${total}`
    : `${state.results.length} candidate${state.results.length === 1 ? '' : 's'}`
}

function refreshCard(item) {
  const current = elements.grid.querySelector(`[data-id="${item.id}"]`)
  if (!current) return
  const holder = document.createElement('div')
  holder.innerHTML = card(item)
  const updated = holder.firstElementChild
  // Patch only changing metadata; leave the audio element and its playback intact.
  for (const selector of ['.score', '.metrics', '.confirmed-mark']) {
    current.querySelector(selector).replaceWith(updated.querySelector(selector))
  }
  current.dataset.decision = item.review?.decision || ''
  for (const button of current.querySelectorAll('.decision')) {
    button.classList.toggle('active', button.dataset.action === item.review?.decision)
  }
}

function sortAnalysedResults(generation) {
  if (generation !== state.searchGeneration) return
  state.sortPending = [...elements.grid.querySelectorAll('audio')].some((audio) => !audio.paused)
  if (state.sortPending) return
  state.results.sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0))
  // Reuse cards so paused clips retain their position and metadata.
  for (const item of state.results) {
    const cardElement = elements.grid.querySelector(`[data-id="${item.id}"]`)
    if (cardElement) elements.grid.append(cardElement)
  }
}

function renderResults() {
  elements.resultCount.textContent = `${state.results.length} candidate${state.results.length === 1 ? '' : 's'}`
  elements.empty.hidden = state.results.length > 0
  elements.grid.innerHTML = state.results.map(card).join('')
}

function card(item) {
  const review = item.review || {}
  const metrics = item.analysis || {}
  return `<article class="recording-card" data-id="${item.id}" data-decision="${review.decision || ''}">
    <img class="spectrogram" src="/spectrogram/${item.id}" alt="Spectrogram for ${escapeHtml(item.scientificName)}" loading="lazy">
    <div class="card-body">
      <div class="card-line">
        <div><strong class="species-name">${escapeHtml(item.commonName || item.scientificName)}</strong>${item.commonName ? `<span class="scientific-name">${escapeHtml(item.scientificName)}</span>` : ''}</div>
        <span class="score">${metrics.score === undefined ? 'Pending' : `${formatMetric(metrics.score, '')}/100`}</span>
      </div>
      <p class="recording-meta">${escapeHtml(item.stationName)} · ${escapeHtml(item.localTime)}</p>
      <audio controls preload="none" src="/media/${item.id}"></audio>
      <div class="metrics">
        ${metric('BirdNET', item.confidence, '%')}
        ${metric('Est. SNR', metrics.estimatedSnrDb, ' dB')}
        ${metric('Peak', metrics.peakDb, ' dB')}
      </div>
      <div class="card-actions">
        <button type="button" class="decision keep ${review.decision === 'keep' ? 'active' : ''}" data-action="keep">Keep</button>
        <button type="button" class="decision reject ${review.decision === 'reject' ? 'active' : ''}" data-action="reject">Reject</button>
        <button type="button" class="file-button" data-action="reveal" title="Open the recording’s folder or copy its path">Show file</button>
        <button type="button" class="details-button" data-action="details" title="Edit Xeno-canto details" aria-label="Edit Xeno-canto details">⋯</button>
      </div>
      <p class="confirmed-mark" ${review.confirmed ? '' : 'hidden'}>Identification confirmed</p>
    </div>
  </article>`
}

function metric(label, value, suffix) {
  return `<div class="metric"><span>${label}</span><strong>${formatMetric(value, suffix)}</strong></div>`
}

async function handleGridClick(event) {
  const button = event.target.closest('button[data-action]')
  if (!button) return
  const cardElement = button.closest('[data-id]')
  const item = state.results.find((entry) => entry.id === cardElement.dataset.id)
  if (button.dataset.action === 'details') return openReview(item)
  if (button.dataset.action === 'reveal') return showFile(item)
  const decision = button.dataset.action
  await patchReview(item, { decision, ...(decision === 'reject' ? { confirmed: false } : {}) })
}

async function showFile(item) {
  try {
    const result = await api(`/api/reveal/${item.id}`, { method: 'POST', body: '{}' })
    byId('filePath').value = result.path
    byId('fileMessage').textContent = result.message
    byId('copyFileStatus').textContent = ''
    if (!byId('fileDialog').open) byId('fileDialog').showModal()
  } catch (error) {
    showToast(error.message)
  }
}

async function copyFilePath() {
  const input = byId('filePath')
  try {
    await navigator.clipboard.writeText(input.value)
    byId('copyFileStatus').textContent = 'Path copied.'
  } catch {
    input.focus()
    input.select()
    byId('copyFileStatus').textContent = 'Copy the selected path with your keyboard or context menu.'
  }
}

function openReview(item) {
  state.activeId = item.id
  byId('reviewError').hidden = true
  const values = { ...item.defaults, vocalisationType: 'song', animalSeen: 'no', playbackUsed: 'no', ...item.review }
  byId('dialogSpecies').textContent = item.commonName || item.scientificName
  byId('dialogStation').textContent = `${item.stationName} · ${item.localTime}`
  for (const field of elements.reviewForm.elements) {
    if (!field.name) continue
    if (field.type === 'checkbox') field.checked = values[field.name] === true
    else field.value = values[field.name] ?? ''
  }
  elements.dialog.showModal()
}

async function saveReviewForm(event) {
  event.preventDefault()
  const form = new FormData(elements.reviewForm)
  const patch = Object.fromEntries(form.entries())
  patch.confirmed = byId('confirmed').checked
  patch.decision = 'keep'
  await saveActive(patch, true)
}

async function saveActive(patch, close = false) {
  const item = state.results.find((entry) => entry.id === state.activeId)
  if (!item) return
  const saved = await patchReview(item, patch)
  if (saved && close) elements.dialog.close()
}

async function patchReview(item, patch) {
  if (state.saving.has(item.id)) return false
  state.saving.add(item.id)
  if (state.activeId === item.id) byId('reviewError').hidden = true
  try {
    const review = await api(`/api/reviews/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    const current = state.results.find((entry) => entry.id === item.id)
    if (current) {
      current.review = review
      refreshCard(current)
    }
    state.bootstrap.reviews[item.id] = review
    updateReviewCounts()
    return true
  } catch (error) {
    if (elements.dialog.open && state.activeId === item.id) {
      byId('reviewError').textContent = error.message
      byId('reviewError').hidden = false
    } else showToast(error.message)
    return false
  } finally {
    state.saving.delete(item.id)
  }
}

async function exportKept() {
  const ids = Object.entries(state.bootstrap.reviews)
    .filter(([, review]) => review.decision === 'keep' && review.confirmed === true)
    .map(([id]) => id)
  if (!ids.length) return showToast('No kept and confirmed recordings are ready to export.')
  elements.export.disabled = true
  try {
    const result = await api('/api/export', { method: 'POST', body: JSON.stringify({ ids }) })
    showToast(`Exported ${result.count} recording${result.count === 1 ? '' : 's'} to ${result.outputDir}`, 8000)
  } catch (error) {
    showToast(error.message)
  } finally {
    elements.export.disabled = false
  }
}

async function rescan() {
  elements.rescan.disabled = true
  elements.archiveStatus.textContent = 'Scanning archive…'
  try {
    await api('/api/scan', { method: 'POST', body: '{}' })
    await bootstrap()
    showToast('Archive index refreshed.')
  } catch (error) {
    showToast(error.message)
  } finally {
    elements.rescan.disabled = false
  }
}

function updateReviewCounts() {
  const reviews = Object.values(state.bootstrap?.reviews || {})
  byId('keptCount').textContent = reviews.filter((review) => review.decision === 'keep').length
  byId('confirmedCount').textContent = reviews.filter((review) => review.decision === 'keep' && review.confirmed).length
  byId('rejectedCount').textContent = reviews.filter((review) => review.decision === 'reject').length
}

function setLoading(active) {
  elements.loading.hidden = !active
  elements.grid.hidden = active
  elements.empty.hidden = active || state.results.length > 0
  elements.searchForm.querySelector('button[type="submit"]').disabled = active
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

let toastTimer
function showToast(message, duration = 4000) {
  clearTimeout(toastTimer)
  elements.toast.textContent = message
  elements.toast.hidden = false
  toastTimer = setTimeout(() => { elements.toast.hidden = true }, duration)
}

function formatNumber(value) { return new Intl.NumberFormat('en-GB').format(value || 0) }
function formatMetric(value, suffix) { return value === null || value === undefined || Number.isNaN(value) ? '—' : `${value}${suffix}` }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]) }
function byId(id) { return document.getElementById(id) }
