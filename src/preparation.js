import { sourceIdentity } from './sources.js'

export const stationFields = ['country', 'location', 'latitude', 'longitude', 'elevation', 'device', 'microphone', 'remarks']
const missing = value => value === undefined || value === null || String(value).trim() === ''
const fallback = (value, defaultValue = '') => missing(value) ? defaultValue : value
export const defaultsKey = config => config.archiveRoot ? sourceIdentity(config) : ''

export function stationDefaults(config, library, store) {
  const station = library.station()
  return {
    country: config.country || '', location: station.location || station.name || '',
    latitude: station.latitude ?? '', longitude: station.longitude ?? '', elevation: station.elevation ?? '',
    device: station.device || '', microphone: station.microphone || '',
    remarks: 'Selected from an autonomous recording; identification manually reviewed.',
    ...store.uploadDefaults?.[defaultsKey(config)],
  }
}

export function validateStationDefaults(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Station details must be an object.')
  const result = {}
  for (const field of stationFields) {
    const value = input[field]
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'number') throw invalid(`Invalid ${field}.`)
    const text = String(value ?? '').trim()
    if (text.length > (field === 'remarks' ? 4000 : 300)) throw invalid(`${field} is too long.`)
    result[field] = text
  }
  for (const [field, minimum, maximum] of [['latitude', -90, 90], ['longitude', -180, 180], ['elevation', -Infinity, Infinity]]) {
    if (!missing(result[field])) {
      const number = Number(result[field])
      if (!Number.isFinite(number) || number < minimum || number > maximum) throw invalid(`Enter a valid ${field}${Number.isFinite(minimum) ? ` between ${minimum} and ${maximum}` : ' in metres'}.`)
      result[field] = number
    }
  }
  return result
}

function invalid(message) { return Object.assign(new Error(message), { statusCode: 400 }) }

export function recordingMetadata(clip, review, defaults, config) {
  const local = localDateTime(clip.timestamp, config.timezone)
  return {
    scientific_name: clip.scientificName, common_name: fallback(review.commonName, clip.commonName || ''),
    date: local.date, time: local.time,
    country: fallback(review.country, defaults.country), location: fallback(review.location, defaults.location),
    latitude: fallback(review.latitude, defaults.latitude), longitude: fallback(review.longitude, defaults.longitude),
    elevation_m: fallback(review.elevation, defaults.elevation), type: review.vocalisationType || '',
    background_species: review.backgroundSpecies || '', sex: review.sex || '', life_stage: review.lifeStage || '',
    animal_seen: review.animalSeen || 'no', playback_used: review.playbackUsed || 'no', automatic_recording: 'yes',
    device: fallback(review.device, defaults.device), microphone: fallback(review.microphone, defaults.microphone),
    remarks: fallback(review.remarks, defaults.remarks),
  }
}

export function preparationChecks(metadata, review) {
  const checks = []
  if (review.confirmed !== true) checks.push('Listen and confirm the identification.')
  if (!metadata.type) checks.push('Choose the sound type (song, call or other).')
  if (!metadata.country) checks.push('Add the country.')
  if (!metadata.location || metadata.location === 'My station') checks.push('Add a public location name.')
  for (const [key, limit] of [['latitude', 90], ['longitude', 180]]) {
    if (missing(metadata[key])) checks.push(`Add the ${key}.`)
    else if (!Number.isFinite(Number(metadata[key])) || Math.abs(Number(metadata[key])) > limit) checks.push(`Check the ${key} (−${limit} to ${limit}).`)
  }
  return checks
}

export function localDateTime(timestamp, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}
