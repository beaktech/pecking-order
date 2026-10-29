export function attachSpectrogramPlayers(grid, onError) {
  const disposers = [...grid.querySelectorAll('.recording-card')].map(card => {
    const audio = card.querySelector('audio')
    const slider = card.querySelector('.spectrogram-player')
    const time = slider.querySelector('.spectrogram-time')
    const playhead = slider.querySelector('.playhead')
    const controls = card.querySelector('.clip-player')
    const play = controls.querySelector('.clip-play')
    const mute = controls.querySelector('.clip-mute')
    const track = controls.querySelector('.clip-seek')
    const volume = controls.querySelector('.clip-volume')
    const rate = controls.querySelector('.clip-rate')
    const options = controls.querySelector('.clip-options')
    audio.hidden = true
    controls.hidden = false
    const events = new AbortController()
    const listen = (target, name, handler) => target.addEventListener(name, handler, { signal: events.signal })
    let frame = 0, pointer = null, pending = null, loading = false
    const duration = () => Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0
    const fraction = () => pending ?? (duration() ? audio.currentTime / duration() : 0)

    function paint() {
      const length = duration()
      const progress = Math.max(0, Math.min(1, fraction()))
      playhead.hidden = audio.paused && progress === 0
      slider.style.setProperty('--playhead', `${progress * 100}%`)
      slider.setAttribute('aria-valuemax', String(length || 100))
      slider.setAttribute('aria-valuenow', (progress * (length || 100)).toFixed(1))
      slider.setAttribute('aria-valuetext', length ? `${formatTime(progress * length)} of ${formatTime(length)}` : loading ? 'Loading recording' : 'Recording not loaded')
      track.value = String(Math.round(progress * 1000))
      track.style.setProperty('--progress', `${progress * 100}%`)
      track.setAttribute('aria-valuetext', slider.getAttribute('aria-valuetext'))
      controls.querySelector('.clip-time').textContent = `${clockTime(progress * length)} / ${length ? clockTime(length) : '—'}`
      controls.dataset.playing = String(!audio.paused && !audio.ended)
      play.setAttribute('aria-label', audio.paused || audio.ended ? 'Play recording' : 'Pause recording')
      time.textContent = length ? `${formatTime(progress * length)} / ${formatTime(length)}` : loading ? 'Loading…' : 'Click to seek'
    }
    function stop() { cancelAnimationFrame(frame); frame = 0 }
    function animate() {
      paint()
      if (!audio.paused && !audio.ended && slider.isConnected) frame = requestAnimationFrame(animate)
      else frame = 0
    }
    function seek(target) {
      pending = Math.max(0, Math.min(1, target))
      if (duration()) {
        audio.currentTime = pending * duration()
        pending = null
      } else if (!loading) {
        loading = true
        audio.preload = 'metadata'
        audio.load()
      }
      paint()
    }
    function seekAt(event) {
      const bounds = slider.getBoundingClientRect()
      if (bounds.width) seek((event.clientX - bounds.left) / bounds.width)
    }
    listen(slider, 'pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return
      event.preventDefault()
      slider.focus({ preventScroll: true })
      pointer = event.pointerId
      slider.setPointerCapture(pointer)
      seekAt(event)
    })
    listen(slider, 'pointermove', event => { if (event.pointerId === pointer) seekAt(event) })
    listen(slider, 'pointerup', event => {
      if (event.pointerId !== pointer) return
      seekAt(event)
      pointer = null
      slider.releasePointerCapture(event.pointerId)
    })
    for (const name of ['pointercancel', 'lostpointercapture']) listen(slider, name, () => { pointer = null })
    listen(slider, 'keydown', event => {
      const step = (event.shiftKey ? 0.1 : 1) / (duration() || 20)
      let target
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = fraction() + step
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = fraction() - step
      else if (event.key === 'Home') target = 0
      else if (event.key === 'End') target = 1
      else return
      event.preventDefault()
      seek(target)
    })
    listen(play, 'click', async () => {
      if (!audio.paused) return audio.pause()
      try { await audio.play() }
      catch (error) {
        if (error.name !== 'AbortError') onError('Could not play this recording. Check that the archive is available, then try again.')
      }
    })
    listen(track, 'input', () => seek(Number(track.value) / 1000))
    listen(mute, 'click', () => {
      if (audio.muted || audio.volume === 0) {
        if (audio.volume === 0) audio.volume = 1
        audio.muted = false
      } else audio.muted = true
    })
    listen(volume, 'input', () => { audio.volume = Number(volume.value); audio.muted = audio.volume === 0 })
    listen(rate, 'change', () => { audio.playbackRate = Number(rate.value) })
    function syncVolume() {
      const muted = audio.muted || audio.volume === 0
      controls.dataset.muted = String(muted)
      mute.setAttribute('aria-pressed', String(muted))
      mute.setAttribute('aria-label', muted ? 'Unmute recording' : 'Mute recording')
      volume.value = String(audio.muted ? 0 : audio.volume)
    }
    listen(audio, 'volumechange', syncVolume)
    listen(audio, 'ratechange', () => { rate.value = String(audio.playbackRate) })
    listen(options, 'keydown', event => {
      if (event.key === 'Escape') { options.open = false; options.querySelector('summary').focus() }
    })
    listen(document, 'pointerdown', event => { if (!options.contains(event.target)) options.open = false })
    syncVolume()
    listen(audio, 'loadedmetadata', () => {
      loading = false
      if (pending !== null && duration()) seek(pending)
      else paint()
    })
    listen(audio, 'play', () => { stop(); animate() })
    for (const name of ['pause', 'ended']) listen(audio, name, () => { stop(); paint() })
    for (const name of ['timeupdate', 'seeking', 'seeked', 'durationchange']) listen(audio, name, paint)
    listen(audio, 'error', () => {
      stop()
      pending = null
      loading = false
      playhead.hidden = true
      time.textContent = 'Audio unavailable'
      slider.setAttribute('aria-valuetext', 'Audio unavailable')
      onError('Could not load this recording. Check that the archive is available, then try again.')
    })
    paint()
    return () => { stop(); events.abort() }
  })
  return () => disposers.forEach(dispose => dispose())
}

function formatTime(seconds) {
  const tenths = Math.floor(seconds * 10)
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}

function clockTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
}
