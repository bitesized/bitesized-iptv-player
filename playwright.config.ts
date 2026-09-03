import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Electron apps are singletons per user-data dir; keep runs serial.
  workers: 1,
  reporter: [['list']]
})
