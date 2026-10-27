const zoneFormatters = new Map()

function zoneFormatter(timeZone) {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    zoneFormatters.set(timeZone, formatter)
  }
  return formatter
}

function zoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    zoneFormatter(timeZone).formatToParts(instant).map(({ type, value }) => [type, value]),
  )
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  )
  // Intl omits milliseconds; compare whole seconds to avoid shifting day ends.
  return asIfUtc - Math.floor(instant / 1000) * 1000
}

/** Read `${date}T${time}` as a wall-clock time in `timeZone` and return epoch ms. */
export function zonedTime(date, time, timeZone) {
  const naive = Date.parse(`${date}T${time}Z`)
  if (Number.isNaN(naive)) return NaN
  // Two passes: the first offset is sampled at the wrong instant whenever the
  // guess lands on the far side of a DST change; the second corrects it.
  const firstGuess = naive - zoneOffsetMs(naive, timeZone)
  return naive - zoneOffsetMs(firstGuess, timeZone)
}

const dayOffsets = new Map()

// Both recording systems can write wall-clock times without an offset. Refuse
// repeated or nonexistent times at DST transitions rather than guessing.
export function recordingTimestamp(date, time, timeZone) {
  const wall = `${date}T${time}`
  const naive = Date.parse(`${wall}Z`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(wall) ||
      !Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== wall) {
    throw new Error(`Invalid recording date or time: ${wall}`)
  }
  const key = `${timeZone}\0${date}`
  let offsets = dayOffsets.get(key)
  if (!offsets) {
    const midday = Date.parse(`${date}T12:00:00Z`)
    offsets = [...new Set([-36, 0, 36].map((hours) => zoneOffsetMs(midday + hours * 3_600_000, timeZone)))]
    dayOffsets.set(key, offsets)
  }
  const candidates = offsets.map((offset) => naive - offset)
    .filter((instant) => instant + zoneOffsetMs(instant, timeZone) === naive)
  if (candidates.length !== 1) {
    throw new Error(`${candidates.length ? 'Ambiguous' : 'Nonexistent'} recording time ${wall} in ${timeZone}; the source has no UTC offset`)
  }
  return new Date(candidates[0]).toISOString()
}
