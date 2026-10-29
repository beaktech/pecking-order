// A fixed popup outside the scrolling sidebar avoids clipping and native datalist placement.
export function createSpeciesPicker({ input, toggle, menu, list, status, label }) {
  let species = [], matches = [], active = -1
  const isOpen = () => !menu.hidden
  const normalise = value => value.trim().toLocaleLowerCase()

  function close() {
    menu.hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    toggle.setAttribute('aria-expanded', 'false')
    active = -1
  }

  function position() {
    if (!isOpen()) return
    const field = input.getBoundingClientRect()
    const viewport = window.visualViewport
    const leftEdge = (viewport?.offsetLeft || 0) + 8
    const topEdge = (viewport?.offsetTop || 0) + 8
    const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - 16
    const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16
    if (field.bottom < topEdge || field.top > bottomEdge) return close()
    const width = Math.min(Math.max(field.width, 340), rightEdge - leftEdge)
    const below = Math.max(0, bottomEdge - field.bottom - 4)
    const above = Math.max(0, field.top - topEdge - 4)
    const upwards = below < 180 && above > below
    menu.style.width = `${width}px`
    menu.style.left = `${Math.max(leftEdge, Math.min(field.left, rightEdge - width))}px`
    menu.style.maxHeight = `${Math.min(320, upwards ? above : below)}px`
    menu.style.top = `${upwards ? field.top - 4 - menu.getBoundingClientRect().height : field.bottom + 4}px`
  }

  function highlight(index, scroll = false) {
    active = index
    for (const [i, option] of [...list.children].entries()) option.setAttribute('aria-selected', String(i === active))
    const option = list.children[active]
    if (option) {
      input.setAttribute('aria-activedescendant', option.id)
      if (scroll) option.scrollIntoView({ block: 'nearest' })
    } else input.removeAttribute('aria-activedescendant')
  }

  function open(all = false) {
    const query = all ? '' : normalise(input.value)
    const filtered = species.filter(item => normalise(label(item)).includes(query))
    matches = filtered.slice(0, 100)
    list.replaceChildren(...matches.map((item, index) => {
      const option = document.createElement('div')
      option.id = `species-option-${index}`
      option.className = 'species-option'
      option.setAttribute('role', 'option')
      option.dataset.index = index
      const name = document.createElement('strong')
      name.textContent = item.commonName || item.scientificName
      const detail = document.createElement('span')
      detail.textContent = `${item.commonName ? `${item.scientificName} · ` : ''}${item.count} clips`
      option.append(name, detail)
      return option
    }))
    status.textContent = !filtered.length ? 'No matching species.' : filtered.length > matches.length ? `Showing ${matches.length} of ${filtered.length} species. Type to narrow the list.` : ''
    status.hidden = !status.textContent
    menu.hidden = false
    input.setAttribute('aria-expanded', 'true')
    toggle.setAttribute('aria-expanded', 'true')
    list.scrollTop = 0
    highlight(-1)
    position()
  }

  const hasSelection = () => species.some(item => normalise(label(item)) === normalise(input.value))
  function choose(index) {
    if (!matches[index]) return
    input.value = label(matches[index])
    input.focus({ preventScroll: true })
    close()
  }

  input.addEventListener('focus', () => open(hasSelection()))
  input.addEventListener('click', () => { if (!isOpen()) open(hasSelection()) })
  input.addEventListener('input', () => open())
  input.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!isOpen()) open(hasSelection())
      if (!matches.length) return
      const next = event.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length : active) - 1
      highlight(next, true)
    } else if (event.key === 'Enter' && isOpen() && active >= 0) {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape' && isOpen()) {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab' || event.key === 'Enter') close()
  })
  toggle.addEventListener('mousedown', event => event.preventDefault())
  toggle.addEventListener('click', () => {
    const wasOpen = isOpen()
    input.focus({ preventScroll: true })
    if (wasOpen) close()
    else open(true)
  })
  list.addEventListener('mousedown', event => event.preventDefault())
  list.addEventListener('click', event => {
    const option = event.target.closest('[role="option"]')
    if (option) choose(Number(option.dataset.index))
  })
  list.addEventListener('pointermove', event => {
    const option = event.target.closest('[role="option"]')
    if (option && event.pointerType === 'mouse') highlight(Number(option.dataset.index))
  })
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target) && !input.contains(event.target) && !toggle.contains(event.target)) close()
  })
  document.addEventListener('focusin', event => {
    if (event.target !== input && event.target !== toggle && !menu.contains(event.target)) close()
  })
  window.addEventListener('resize', position)
  document.addEventListener('scroll', position, true)
  window.visualViewport?.addEventListener('resize', position)
  window.visualViewport?.addEventListener('scroll', position)
  return {
    close,
    setSpecies(items) {
      species = items
      if (isOpen()) open(hasSelection())
    },
  }
}
