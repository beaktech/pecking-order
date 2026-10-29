import { test as base, expect } from '@playwright/test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadConfig } from '../src/config.js'
import { scanLibrary } from '../src/library.js'
import { Store } from '../src/store.js'
import { AudioAnalyser } from '../src/analyse.js'
import { createAppServer } from '../src/server.js'

const run = promisify(execFile)

export const test = base.extend({
  app: async ({ browserName }, use) => {
    const root = await mkdtemp(join(tmpdir(), `pecking-order-browser-${browserName}-`))
    let server
    try {
      const archive = join(root, 'clips')
      await mkdir(archive)
      for (const [slug, confidence, time] of [['parus_major', 98, '060000'], ['parus_major', 90, '061000'], ['erithacus_rubecula', 95, '062000']]) {
        await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=2000:duration=6', join(archive, `${slug}_${confidence}p_20260515T${time}Z.wav`)])
      }
      const config = await loadConfig(undefined, { workspaceRoot: root, source: 'birdnet-go', archive, sourceTimezone: 'UTC', env: {} })
      const library = await scanLibrary(config)
      const store = await new Store(config.dataRoot).load()
      const analyser = new AudioAnalyser(store)
      await Promise.all(library.clips.map(clip => analyser.analyse(clip)))
      server = createAppServer({ config, store, analyser, getLibrary: () => library, rescan: async () => library })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      await use({ url: `http://127.0.0.1:${server.address().port}`, root, library, store, config })
    } finally {
      if (server?.listening) await new Promise(resolve => server.close(resolve))
      await rm(root, { recursive: true, force: true })
    }
  },
})

export { expect }

export async function searchGreatTits(page, app) {
  await page.goto(app.url)
  await expect(page.locator('#archiveStatus')).toContainText('3 clips')
  const species = page.locator('#speciesInput')
  await species.fill('Great Tit')
  await species.press('ArrowDown')
  await species.press('Enter')
  await page.locator('#searchForm button[type="submit"]').click()
  await expect(page.locator('.recording-card')).toHaveCount(2)
}

export async function prepareKeptClip(page, app) {
  const clip = app.library.clips.find(item => item.slug === 'parus_major')
  await app.store.saveReview(clip.id, { decision: 'keep' })
  await page.goto(app.url)
  await expect(page.locator('#archiveStatus')).toContainText('3 clips')
  await page.locator('#exportButton').click()
  await expect(page.locator('.preparation-clip')).toHaveCount(1)
  return clip
}
