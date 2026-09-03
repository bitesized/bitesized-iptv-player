// E2E boot smoke: launches the real built app and fails on ANY renderer
// console error, page error, or CSP violation — a blank/black window always
// produces at least one of those. Run `npm run build` first (test:e2e does).

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

let app: ElectronApplication
let page: Page
let consoleErrors: string[]

test.beforeAll(async () => {
  consoleErrors = []
  app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      IPTV_USER_DATA: mkdtempSync(join(tmpdir(), 'iptv-e2e-')),
      ELECTRON_ENABLE_LOGGING: '0'
    }
  })
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(`pageerror: ${error.message}`)
  })
})

test.afterAll(async () => {
  await app.close()
})

test('renderer mounts real content (no black screen)', async () => {
  await page.waitForSelector('#root *', { timeout: 15_000 })
  // The app shell nav must be visible on a fresh profile.
  await expect(page.getByText('Bitesized IPTV Player').first()).toBeVisible()
  const rootHtml = await page.locator('#root').innerHTML()
  expect(rootHtml.length).toBeGreaterThan(100)
})

test('fresh install lands on the welcome state with a working profile', async () => {
  await expect(page.getByText(/Add a provider/i).first()).toBeVisible()
})

test('every nav destination renders without errors', async () => {
  const destinations: [string, RegExp][] = [
    ['Live TV', /No channels here yet|Live TV/i],
    ['Movies', /No movies here yet|Sort/i],
    ['Series', /No series here yet/i],
    ['TV Guide', /Add a provider to see the TV guide/i],
    ['Search', /Type at least two characters/i],
    ['Settings', /Providers/i],
    ['Home', /Add a provider|Welcome/i]
  ]
  for (const [label, expected] of destinations) {
    await page.getByRole('link', { name: label }).click()
    await expect(page.getByText(expected).first()).toBeVisible({ timeout: 5000 })
  }
})

test('onboarding form renders and switches between Xtream and M3U', async () => {
  await page.getByRole('link', { name: 'Home' }).click()
  await page.getByText('Add a provider', { exact: true }).click()
  await expect(page.getByPlaceholder(/Server \(http/)).toBeVisible()
  await page.getByRole('button', { name: 'M3U Playlist' }).click()
  await expect(page.getByPlaceholder(/Playlist URL/)).toBeVisible()
  await page.getByText('Skip for now').click()
})

test('profile switcher opens the picker and returns', async () => {
  await page.getByText('Switch profile').click()
  await expect(page.getByText(/Who's watching\?/)).toBeVisible()
  // The avatar tile (not the name label) activates the profile.
  await page.getByRole('button', { name: '👤' }).click()
  await expect(page.getByText('Bitesized IPTV Player').first()).toBeVisible()
})

test('no console errors, page errors or CSP violations during the session', () => {
  expect(consoleErrors).toEqual([])
})
