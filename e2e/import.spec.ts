// Full-flow E2E: a fake Xtream panel runs on localhost; the test drives the
// real app through onboarding → credential validation → catalog import →
// browsing every content kind → search, and fails on any console error.

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const PANEL: Record<string, unknown> = {
  auth: { user_info: { auth: 1, username: 'user', max_connections: '2' }, server_info: {} },
  get_live_categories: [{ category_id: '1', category_name: 'News' }],
  get_vod_categories: [{ category_id: '2', category_name: 'Action' }],
  get_series_categories: [{ category_id: '3', category_name: 'Drama' }],
  get_live_streams: [
    {
      stream_id: '11',
      name: 'E2E News Channel',
      category_id: '1',
      num: '1',
      epg_channel_id: 'news.e2e',
      tv_archive: '1'
    },
    { stream_id: '12', name: 'E2E Sports Channel', category_id: '1', num: '2' }
  ],
  get_vod_streams: [
    {
      stream_id: '21',
      name: 'The E2E Matrix',
      category_id: '2',
      container_extension: 'mkv',
      rating: '8.7',
      added: '1700000000'
    }
  ],
  get_series: [{ series_id: '31', name: 'E2E Breaking Code', category_id: '3' }],
  get_simple_data_table: { epg_listings: [] },
  get_short_epg: { epg_listings: [] }
}

let panel: Server
let panelPort: number
let app: ElectronApplication
let page: Page
let consoleErrors: string[]

test.beforeAll(async () => {
  panel = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/player_api.php') {
      res.writeHead(404).end()
      return
    }
    const action = url.searchParams.get('action') ?? 'auth'
    const body = PANEL[action]
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body ?? []))
  })
  await new Promise<void>((resolve) => panel.listen(0, '127.0.0.1', resolve))
  panelPort = (panel.address() as { port: number }).port

  consoleErrors = []
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, IPTV_USER_DATA: mkdtempSync(join(tmpdir(), 'iptv-e2e-import-')) }
  })
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))
})

test.afterAll(async () => {
  await app.close()
  panel.close()
})

test('onboarding connects and validates against the panel', async () => {
  await page.waitForSelector('#root *')
  await page.getByText('Add a provider', { exact: true }).click()
  await page.getByPlaceholder(/Server \(http/).fill(`http://127.0.0.1:${panelPort}`)
  await page.getByPlaceholder('Username').fill('user')
  await page.getByPlaceholder('Password').fill('pass')
  await page.getByRole('button', { name: /Connect & import/ }).click()
  // Successful validation navigates back to Home.
  await expect(
    page.getByText(/Recently added|importing or empty|Continue watching/i).first()
  ).toBeVisible({ timeout: 15_000 })
})

test('the catalog imports and the provider reports synced', async () => {
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByText('Synced', { exact: false }).first()).toBeVisible({
    timeout: 20_000
  })
})

test('live channels browse with categories and counts', async () => {
  await page.getByRole('link', { name: 'Live TV' }).click()
  await expect(page.getByText('E2E News Channel')).toBeVisible()
  await expect(page.getByText('E2E Sports Channel')).toBeVisible()
  await expect(page.getByText('CATCH-UP')).toBeVisible() // tv_archive channel badge
  // Category sidebar shows the imported category (scoped: a channel row
  // also contains "News" in its name).
  await page.locator('aside').getByRole('button', { name: /News/ }).click()
  await expect(page.getByText('E2E News Channel')).toBeVisible()
})

test('movies grid and detail page render imported VOD', async () => {
  await page.getByRole('link', { name: 'Movies' }).click()
  await expect(page.getByText('The E2E Matrix').first()).toBeVisible()
  await page.getByText('The E2E Matrix').first().click()
  await expect(page.getByRole('button', { name: '▶ Play' })).toBeVisible()
  await expect(page.getByText(/8\.7/)).toBeVisible()
  await page.getByText('← Back').click()
})

test('series grid renders imported series', async () => {
  await page.getByRole('link', { name: 'Series' }).click()
  await expect(page.getByText('E2E Breaking Code').first()).toBeVisible()
})

test('FTS search finds imported content across kinds', async () => {
  await page.getByRole('link', { name: 'Search' }).click()
  await page.getByPlaceholder(/Search channels/).fill('e2e matr')
  await expect(page.getByText('The E2E Matrix')).toBeVisible()
  await page.getByPlaceholder(/Search channels/).fill('sports')
  await expect(page.getByText('E2E Sports Channel')).toBeVisible()
})

test('favorites toggle from search surfaces on Home', async () => {
  await page.getByRole('link', { name: 'Movies' }).click()
  // Hover the poster card to reveal the favorite heart, then toggle it.
  const card = page.getByRole('button', { name: /The E2E Matrix/ }).first()
  await card.hover()
  await page.getByLabel('Add to favorites').first().click()
  await page.getByRole('link', { name: 'Home' }).click()
  // Heading, not text: the left nav also has a "Favorites" entry now.
  await expect(page.getByRole('heading', { name: 'Favorites' })).toBeVisible()
})

test('the favorites screen groups the favorite under its category', async () => {
  await page.getByRole('link', { name: 'Favorites' }).click()
  // Type heading, then the provider category it came from, then the item.
  await expect(page.getByRole('heading', { name: 'Movies' })).toBeVisible()
  await expect(page.getByRole('button', { name: /The E2E Matrix/ }).first()).toBeVisible()
})

test('no console errors during the whole import flow', () => {
  expect(consoleErrors).toEqual([])
})
