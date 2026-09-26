// At-rest encryption for local secrets. The 32-byte vault key is created by the
// Electron main process and kept in the OS keychain (Electron safeStorage); it is
// handed to this worker over the IPC pipe and never written to disk in plain text.
const sodium = require('sodium-universal')
const b4a = require('b4a')

const NONCE = sodium.crypto_secretbox_NONCEBYTES
const MAC = sodium.crypto_secretbox_MACBYTES
const MAGIC = b4a.from('p2pv1')

class Vault {
  /** @param {Buffer | null} key 32 bytes, or null for no at-rest encryption (tests) */
  constructor (key) {
    this.key = key && key.byteLength === sodium.crypto_secretbox_KEYBYTES ? key : null
  }

  get enabled () {
    return this.key !== null
  }

  seal (plain) {
    const nonce = b4a.allocUnsafe(NONCE)
    sodium.randombytes_buf(nonce)
    const cipher = b4a.allocUnsafe(plain.byteLength + MAC)
    sodium.crypto_secretbox_easy(cipher, plain, nonce, this.key)
    return b4a.concat([MAGIC, nonce, cipher])
  }

  open (sealed) {
    if (!isSealed(sealed)) throw new Error('VAULT_FORMAT')
    const nonce = sealed.subarray(MAGIC.byteLength, MAGIC.byteLength + NONCE)
    const cipher = sealed.subarray(MAGIC.byteLength + NONCE)
    const plain = b4a.allocUnsafe(cipher.byteLength - MAC)
    if (!sodium.crypto_secretbox_open_easy(plain, cipher, nonce, this.key)) throw new Error('VAULT_LOCKED')
    return plain
  }

  // Autobase stores each group's encryption key locally; with this it stores it sealed
  get blindEncryption () {
    if (!this.enabled) return null
    return {
      encrypt: async (data) => ({ type: 1, value: this.seal(data) }),
      decrypt: async ({ value }) => ({ value: this.open(value), rotated: false })
    }
  }
}

function isSealed (buf) {
  return buf.byteLength > MAGIC.byteLength + NONCE + MAC && b4a.equals(buf.subarray(0, MAGIC.byteLength), MAGIC)
}

Vault.isSealed = isSealed

module.exports = Vault
