const fields = [
  ['scientific_name', 'Species'], ['common_name', 'Common name'], ['date', 'Date'], ['time', 'Time'],
  ['country', 'Country'], ['location', 'Location'], ['latitude', 'Latitude'], ['longitude', 'Longitude'],
  ['elevation_m', 'Elevation (m)'], ['type', 'Sound type'], ['background_species', 'Background species'],
  ['sex', 'Sex'], ['life_stage', 'Life stage'], ['animal_seen', 'Animal seen'], ['playback_used', 'Playback used'],
  ['automatic_recording', 'Automatic recording'], ['device', 'Recorder'], ['microphone', 'Microphone'], ['remarks', 'Remarks'],
]
const byId = id => document.getElementById(id)
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])

export function createUploadPreparation({ api, openReview }) {
  const dialog = byId('preparationDialog')
  const form = byId('stationDefaultsForm')
  const list = byId('preparationClips')
  const status = byId('preparationStatus')
  const exportButton = byId('preparationExport')
  let data = null, loading = false, exporting = false, saving = false, generation = 0

  const draft = new Map()
  form.addEventListener('input', event => {
    if (event.target.name) draft.set(event.target.name, event.target.value)
  })

  function updateExport() {
    const confirmed = data?.clips.filter(item => item.review.confirmed === true) || []
    exportButton.textContent = exporting ? 'Exporting…' : `Export confirmed clips (${confirmed.length})`
    exportButton.disabled = loading || saving || exporting || !confirmed.length
    const unconfirmed = (data?.clips.length || 0) - confirmed.length
    const incomplete = confirmed.filter(item => item.checks.length).length
    byId('preparationExportNote').textContent = [
      unconfirmed ? `${unconfirmed} kept clip${unconfirmed === 1 ? '' : 's'} still need identification confirmation and will not be exported.` : '',
      incomplete ? `${incomplete} confirmed clip${incomplete === 1 ? '' : 's'} still have details to check before uploading. You can export them now and complete the metadata later.` : '',
    ].filter(Boolean).join(' ')
  }

  async function reload() {
    const current = ++generation
    loading = true
    form.querySelector('fieldset').disabled = true
    updateExport()
    try {
      const result = await api('/api/preparation')
      if (current !== generation) return
      data = result
      for (const field of form.elements) if (field.name) field.value = draft.has(field.name) ? draft.get(field.name) : data.defaults[field.name] ?? ''
      const complete = data.clips.filter(item => !item.checks.length).length
      byId('preparationSummary').textContent = `${data.clips.length} kept clips · ${complete} with preparation checks complete. Dates and times use ${data.timezone}.`
      byId('preparationEmpty').hidden = data.clips.length > 0
      list.innerHTML = data.clips.map(item => {
        const name = item.commonName ? `${item.commonName} (${item.scientificName})` : item.scientificName
        return `<article class="preparation-clip" data-id="${escape(item.id)}">
          <div class="preparation-clip-heading"><div><h3>${escape(name)}</h3><p>${escape(item.localTime)}</p></div><span class="preparation-state ${item.checks.length ? '' : 'complete'}">${item.checks.length ? 'Needs review' : 'Checks complete'}</span></div>
          <audio controls preload="none" src="/media/${escape(item.id)}" aria-label="Listen to ${escape(name)}"></audio>
          ${item.checks.length ? `<ul class="preparation-checks">${item.checks.map(check => `<li>${escape(check)}</li>`).join('')}</ul>` : ''}
          <div class="preparation-clip-actions"><button type="button" class="button secondary" data-preparation-action="edit">${item.review.confirmed ? 'Edit details' : 'Review & confirm'}</button><button type="button" class="button secondary" data-preparation-action="copy">Copy all details</button></div>
          <details class="preparation-metadata"><summary>Individual fields to copy</summary><dl>${fields.map(([key, label]) => {
            const value = item.metadata[key]
            const empty = value === '' || value === null || value === undefined
            return `<div><dt>${escape(label)}</dt><dd>${empty ? '<span class="preparation-unset">Not set</span>' : escape(value)}</dd><button type="button" class="button" data-preparation-action="field" data-field="${key}" aria-label="Copy ${escape(label.toLowerCase())}" ${empty ? 'disabled' : ''}>Copy</button></div>`
          }).join('')}</dl></details>
        </article>`
      }).join('')
    } catch (error) {
      if (current !== generation) return
      status.textContent = error.message
      data = null
      list.replaceChildren()
    } finally {
      if (current === generation) {
        loading = false
        form.querySelector('fieldset').disabled = !data
        updateExport()
      }
    }
  }

  async function copy(text, label = 'Details') {
    try {
      await navigator.clipboard.writeText(String(text))
      byId('preparationCopyFallback').hidden = true
      status.textContent = `${label} copied.`
    } catch {
      byId('preparationCopyFallback').hidden = false
      const input = byId('preparationCopyText')
      input.value = String(text)
      input.focus()
      input.select()
      status.textContent = 'Copy the selected text with your keyboard or context menu.'
    }
  }

  byId('closePreparation').addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => { for (const audio of dialog.querySelectorAll('audio')) audio.pause() })
  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (saving || loading) return
    // Capture before disabling the fieldset: disabled fields are omitted by FormData.
    const details = Object.fromEntries(new FormData(form))
    saving = true
    form.querySelector('fieldset').disabled = true
    updateExport()
    try {
      await api('/api/preparation/defaults', { method:'PUT', body:JSON.stringify(details) })
      draft.clear()
      await reload()
      status.textContent = 'Station details saved. Individual recording overrides have been preserved.'
    } catch (error) { status.textContent = error.message }
    finally { saving = false; form.querySelector('fieldset').disabled = !data; updateExport() }
  })
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-preparation-action]')
    if (!button || !data) return
    const item = data.clips.find(clip => clip.id === button.closest('[data-id]').dataset.id)
    if (!item) return
    if (button.dataset.preparationAction === 'edit') return openReview(item)
    if (button.dataset.preparationAction === 'field') {
      const field = fields.find(([key]) => key === button.dataset.field)
      if (field) void copy(item.metadata[field[0]], field[1])
    } else void copy(fields.filter(([key]) => item.metadata[key] !== '' && item.metadata[key] != null).map(([key, label]) => `${label}: ${item.metadata[key]}`).join('\n'))
  })
  exportButton.addEventListener('click', async () => {
    if (exportButton.disabled || !data) return
    const ids = data.clips.filter(item => item.review.confirmed === true).map(item => item.id)
    exporting = true
    updateExport()
    try {
      const result = await api('/api/export', { method:'POST', body:JSON.stringify({ ids }) })
      byId('preparationExportResult').hidden = false
      byId('preparationExportPath').value = result.outputDir
      status.textContent = `Exported ${result.count} recordings. The WAV files and metadata CSV are in the folder below.`
    } catch (error) { status.textContent = error.message }
    finally { exporting = false; updateExport() }
  })
  byId('preparationCopyPath').addEventListener('click', () => void copy(byId('preparationExportPath').value, 'Folder path'))
  return {
    async open() {
      status.textContent = 'Loading kept clips…'
      if (!dialog.open) dialog.showModal()
      await reload()
      if (data) status.textContent = ''
    },
    refresh: () => dialog.open ? reload() : Promise.resolve(),
  }
}
