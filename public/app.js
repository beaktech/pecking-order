import { createUploadPreparation } from './upload-preparation.js'
import { createSpeciesPicker } from './species-picker.js'
import { attachSpectrogramPlayers } from './spectrogram-player.js'

let disposePlayers, activeReview

const state = { bootstrap: null, results: [], activeId: null, searchGeneration: 0, sortPending: false, saving: new Set() }

const elements = {
  archiveStatus: byId('archiveStatus'), speciesTotal: byId('speciesTotal'), speciesInput: byId('speciesInput'),
  speciesList: byId('speciesList'), confidenceInput: byId('confidenceInput'),
  confidenceOutput: byId('confidenceOutput'), searchForm: byId('searchForm'), loading: byId('loadingState'),
  empty: byId('emptyState'), grid: byId('recordingGrid'), resultTitle: byId('resultTitle'),
  resultContext: byId('resultContext'), resultCount: byId('resultCount'), rescan: byId('rescanButton'),
  export: byId('exportButton'), dialog: byId('reviewDialog'), reviewForm: byId('reviewForm'), toast: byId('toast'),
}

const speciesPicker = createSpeciesPicker({
  input: elements.speciesInput, toggle: byId('speciesToggle'), menu: byId('speciesMenu'),
  list: elements.speciesList, status: byId('speciesMatches'), label: speciesLabel,
})

const preparation = createUploadPreparation({ api, openReview })
elements.dialog.addEventListener('close', () => { void preparation.refresh() })

void bootstrap().catch((error) => showToast(error.message))

elements.confidenceInput.addEventListener('input', () => { elements.confidenceOutput.value = `${elements.confidenceInput.value}%` })
elements.searchForm.addEventListener('submit', search)
elements.rescan.addEventListener('click', rescan)
elements.export.addEventListener('click', () => { speciesPicker.close(); void preparation.open() })
byId('closeDialog').addEventListener('click', () => elements.dialog.close())
byId('copyFilePath').addEventListener('click', copyFilePath)
byId('rejectDialog').addEventListener('click', () => saveActive({ decision: 'reject', confirmed: false }, true))
elements.reviewForm.addEventListener('submit', saveReviewForm)
elements.grid.addEventListener('click', handleGridClick)
// Keep one recording audible, and defer ranking changes until listening stops.
document.addEventListener('play', (event) => {
  for (const audio of document.querySelectorAll('audio')) {
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
  speciesPicker.setSpecies(data.species)
  const warnings = data.warnings || []
  byId('importWarnings').hidden = !warnings.length
  byId('importWarningList').innerHTML = warnings.map((item) => `<li>${item.message ? escapeHtml(item.message) : `${escapeHtml(item.reason)}: ${formatNumber(item.count)}. ${item.examples.map(escapeHtml).join('; ')}`}</li>`).join('')
  updateReviewCounts()
}

async function search(event) {
  event.preventDefault()
  if (!state.bootstrap) return showToast('Archive is not ready. Try Rescan.')
  const speciesName = elements.speciesInput.value.trim()
  const species = state.bootstrap.species.find((item) =>
    [item.scientificName, item.commonName, speciesLabel(item)].some((name) => name?.toLowerCase() === speciesName.toLowerCase()))
  if (!species) return showToast('Choose a species from the archive list.')
  speciesPicker.close()
  elements.speciesInput.value = speciesLabel(species)
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
    elements.resultTitle.textContent = speciesLabel(species)
    elements.resultContext.textContent = state.bootstrap.station.name || 'My station'
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
  for (const selector of ['.score', '.metrics', '.confirmed-mark', '.kept-badge']) {
    current.querySelector(selector).replaceWith(updated.querySelector(selector))
  }
  current.dataset.decision = item.review?.decision || ''
  for (const button of current.querySelectorAll('.decision')) {
    const active = button.dataset.action === item.review?.decision
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
    if (button.dataset.action === 'keep') button.querySelector('.action-label').textContent = active ? 'Kept' : 'Keep'
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
  disposePlayers?.()
  elements.grid.innerHTML = state.results.map(card).join('')
  disposePlayers = attachSpectrogramPlayers(elements.grid, showToast)
}

function card(item) {
  const review = item.review || {}
  const metrics = item.analysis || {}
  return `<article class="recording-card" data-id="${item.id}" data-decision="${review.decision || ''}">
    <div class="spectrogram-player" role="slider" tabindex="0" aria-label="Playback position for ${escapeHtml(speciesLabel(item))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" title="Click or drag to seek. Arrow keys move one second; Shift + arrow moves a tenth of a second.">
      <img class="spectrogram" src="/spectrogram/${item.id}" alt="Spectrogram for ${escapeHtml(speciesLabel(item))}" loading="lazy" draggable="false">
      <span class="kept-badge" ${review.decision === 'keep' ? '' : 'hidden'}>${icon('check')} Kept</span>
      <span class="playhead" aria-hidden="true" hidden></span>
      <span class="spectrogram-time" aria-hidden="true">Click to seek</span>
    </div>
    <audio controls preload="none" src="/media/${item.id}"></audio>
    <div class="clip-player" hidden>
      <button type="button" class="clip-play" aria-label="Play recording">${icon('play')}${icon('pause')}</button>
      <span class="clip-time">0:00 / —</span>
      <input class="clip-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Playback position">
      <button type="button" class="clip-mute" aria-label="Mute recording" aria-pressed="false">${icon('volume')}${icon('muted')}</button>
      <details class="clip-options">
        <summary aria-label="Playback options" title="Playback options">${icon('more')}</summary>
        <div class="clip-options-panel">
          <label>Volume<input class="clip-volume" type="range" min="0" max="1" step="0.05" value="1"></label>
          <label>Playback speed<select class="clip-rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
        </div>
      </details>
    </div>
    <div class="card-body">
      <div class="card-line">
        <div><strong class="species-name">${escapeHtml(item.commonName || item.scientificName)}</strong>${item.commonName ? `<span class="scientific-name">${escapeHtml(item.scientificName)}</span>` : ''}</div>
        <span class="score" aria-label="Quality score ${metrics.score === undefined ? 'pending' : `${metrics.score} out of 100`}">${icon('star')}<span>${metrics.score === undefined ? 'Pending' : `${formatMetric(metrics.score, '')}<small>/100</small>`}</span></span>
      </div>
      <p class="recording-meta">${icon('pin')}<span>${escapeHtml(item.stationName)} <span class="meta-separator">·</span> ${escapeHtml(item.localTime)}</span></p>
      <div class="metrics">
        ${metric('BirdNET', item.confidence, '%', 'wave')}
        ${metric('Est. SNR', metrics.estimatedSnrDb, ' dB', 'bars')}
        ${metric('Peak', metrics.peakDb, ' dB', 'peak')}
      </div>
      <div class="card-actions">
        <button type="button" class="decision keep ${review.decision === 'keep' ? 'active' : ''}" data-action="keep" aria-pressed="${review.decision === 'keep'}">${icon('check')}<span class="action-label">${review.decision === 'keep' ? 'Kept' : 'Keep'}</span></button>
        <button type="button" class="decision reject ${review.decision === 'reject' ? 'active' : ''}" data-action="reject" aria-pressed="${review.decision === 'reject'}">${icon('cross')}<span class="action-label">Reject</span></button>
        <button type="button" class="file-button" data-action="reveal" title="Open the recording’s folder or copy its path">${icon('file')}<span>Show file</span></button>
        <button type="button" class="details-button" data-action="details" title="Edit Xeno-canto details" aria-label="Edit Xeno-canto details">${icon('more')}</button>
      </div>
      <p class="confirmed-mark" ${review.confirmed ? '' : 'hidden'}>Identification confirmed</p>
    </div>
  </article>`
}

function metric(label, value, suffix, symbol) {
  return `<div class="metric">${icon(symbol)}<div><span>${label}</span><strong>${formatMetric(value, suffix)}</strong></div></div>`
}

function icon(name) {
  const paths = {
    play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
    volume: '<path d="m11 4-6 5H2v6h3l6 5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    muted: '<path d="m11 4-6 5H2v6h3l6 5Z"/><path d="m16 9 6 6m0-6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" fill="currentColor" stroke="none"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    wave: '<path d="M2 12h3l2-6 3 13 3-16 3 18 2-12 2 3h2"/>',
    bars: '<path d="M5 17v3M12 11v9M19 4v16" stroke-width="5"/>',
    peak: '<circle cx="12" cy="12" r="9" opacity=".3"/><path d="m5 16 5-5 4 3 5-8m-5 0h5v5"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    cross: '<path d="m6 6 12 12M6 18 18 6"/>',
    file: '<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
  }
  return `<svg class="icon icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`
}

async function handleGridClick(event) {
  const button = event.target.closest('button[data-action]')
  if (!button) return
  const cardElement = button.closest('[data-id]')
  const item = state.results.find((entry) => entry.id === cardElement.dataset.id)
  if (button.dataset.action === 'details') {
    try {
      const { defaults } = await api('/api/preparation/defaults')
      return openReview({ ...item, defaults: { ...item.defaults, ...defaults } })
    } catch (error) { return showToast(error.message) }
  }
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
  activeReview = item
  byId('reviewError').hidden = true
  const values = { ...item.defaults, vocalisationType: '', animalSeen: 'no', playbackUsed: 'no', ...item.review }
  for (const [key, value] of Object.entries(item.defaults)) {
    if (values[key] === '' || values[key] == null) values[key] = value
  }
  byId('dialogSpecies').textContent = speciesLabel(item)
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
  for (const key of ['country', 'location', 'latitude', 'longitude', 'elevation', 'device', 'microphone', 'remarks']) {
    if (String(patch[key] ?? '') === String(activeReview.defaults[key] ?? '')) patch[key] = ''
  }
  patch.confirmed = byId('confirmed').checked
  patch.decision = 'keep'
  await saveActive(patch, true)
}

async function saveActive(patch, close = false) {
  const item = activeReview
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

function speciesLabel({ commonName, scientificName }) {
  return commonName && commonName !== scientificName ? `${commonName} (${scientificName})` : scientificName
}

function formatNumber(value) { return new Intl.NumberFormat('en-GB').format(value || 0) }
function formatMetric(value, suffix) { return value === null || value === undefined || Number.isNaN(value) ? '—' : `${value}${suffix}` }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]) }
function byId(id) { return document.getElementById(id) }
