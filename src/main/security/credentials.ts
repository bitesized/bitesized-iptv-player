import { safeStorage } from 'electron'

/**
 * Passwords are encrypted with the OS keychain via Electron safeStorage and
 * stored as BLOBs in providers.enc_password. If the OS has no keychain
 * (some Linux setups), we fall back to plaintext-in-DB with a marker prefix —
 * better than refusing to work, and flagged so we can warn in the UI.
 */
const PLAINTEXT_MARKER = Buffer.from('PLAIN:')

/**
 * safeStorage is absent when the module is loaded outside a real Electron main
 * process (ELECTRON_RUN_AS_NODE, which is how the test suite runs). Treat that
 * like a machine with no keychain rather than crashing.
 */
function keychainAvailable(): boolean {
  return (
    typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
  )
}

export function encryptSecret(secret: string): Buffer {
  if (keychainAvailable()) {
    return safeStorage.encryptString(secret)
  }
  return Buffer.concat([PLAINTEXT_MARKER, Buffer.from(secret, 'utf8')])
}

export function decryptSecret(blob: Buffer): string {
  if (blob.subarray(0, PLAINTEXT_MARKER.length).equals(PLAINTEXT_MARKER)) {
    return blob.subarray(PLAINTEXT_MARKER.length).toString('utf8')
  }
  if (!keychainAvailable()) {
    throw new Error('Stored credential needs the OS keychain, which is unavailable')
  }
  return safeStorage.decryptString(blob)
}
