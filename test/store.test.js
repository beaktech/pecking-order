import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCORING_VERSION } from '../src/analyse.js'
import { Store } from '../src/store.js'

async function storeWith(state) {
  const dir = await mkdtemp(join(tmpdir(), 'pecking-order-'))
  await writeFile(join(dir, 'state.json'), JSON.stringify(state))
  return { dir, store: await new Store(dir).load() }
}

test('discards metrics cached by an older scoring formula but keeps reviews', async () => {
  const { store } = await storeWith({
    metricsVersion: SCORING_VERSION - 1,
    metrics: { abc: { score: 90 } },
    reviews: { abc: { decision: 'keep', confirmed: true } },
  })
  assert.deepEqual(store.metrics, {})
  assert.deepEqual(store.reviews.abc, { decision: 'keep', confirmed: true })
})

test('treats state written before versioning as stale', async () => {
  const { store } = await storeWith({ metrics: { abc: { score: 90 } }, reviews: {} })
  assert.deepEqual(store.metrics, {})
})

test('keeps metrics from the current formula', async () => {
  const { store } = await storeWith({ metricsVersion: SCORING_VERSION, metrics: { abc: { score: 90 } }, reviews: {} })
  assert.deepEqual(store.metrics, { abc: { score: 90 } })
})

test('records the scoring version it saved under', async () => {
  const { dir, store } = await storeWith({ metricsVersion: SCORING_VERSION, metrics: {}, reviews: {} })
  store.updateReview('abc', { decision: 'keep' })
  await store.save()
  const written = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(written.metricsVersion, SCORING_VERSION)
  assert.equal(written.reviews.abc.decision, 'keep')
})

test('ignores review fields that are not on the permitted list', async () => {
  const { store } = await storeWith({ metrics: {}, reviews: {} })
  const review = store.updateReview('abc', { decision: 'keep', score: 100, path: '/etc/passwd' })
  assert.equal(review.decision, 'keep')
  assert.equal(review.score, undefined)
  assert.equal(review.path, undefined)
})

test('a failed save does not block later saves', async () => {
  const { dir, store } = await storeWith({ metrics: {}, reviews: {} })
  store.updateReview('abc', { decision: 'keep' })
  const goodPath = store.path
  store.path = join(dir, 'state.json', 'not-a-directory')
  await assert.rejects(store.save())
  store.path = goodPath
  store.updateReview('abc', { confirmed: true })
  await store.save()
  const written = JSON.parse(await readFile(goodPath, 'utf8'))
  assert.equal(written.reviews.abc.confirmed, true)
})

test('drops cached analysis failures while retaining measurements and reviews', async () => {
  const { store } = await storeWith({ metricsVersion: SCORING_VERSION, metrics: { bad: { error: 'Audio could not be analysed', score: 40 }, good: { score: 90 } }, reviews: { bad: { decision: 'keep' } } })
  assert.deepEqual(store.metrics, { good: { score: 90 } })
  assert.equal(store.reviews.bad.decision, 'keep')
})
