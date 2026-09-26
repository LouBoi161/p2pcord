// Anonymous public-key encryption to an identity (Ed25519 key converted to
// X25519): only the holder of that identity's secret key can open the box.
const sodium = require('sodium-universal')
const b4a = require('b4a')

function toCurvePublic (edPublicKey) {
  const out = b4a.allocUnsafe(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(out, edPublicKey)
  return out
}

function sealTo (edPublicKey, message) {
  const box = b4a.allocUnsafe(message.byteLength + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(box, message, toCurvePublic(edPublicKey))
  return box
}

function openSealed ({ publicKey, secretKey }, box) {
  if (box.byteLength <= sodium.crypto_box_SEALBYTES) return null
  const curveSecret = b4a.allocUnsafe(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_sign_ed25519_sk_to_curve25519(curveSecret, secretKey)
  const out = b4a.allocUnsafe(box.byteLength - sodium.crypto_box_SEALBYTES)
  const ok = sodium.crypto_box_seal_open(out, box, toCurvePublic(publicKey), curveSecret)
  sodium.sodium_memzero(curveSecret)
  return ok ? out : null
}

module.exports = { sealTo, openSealed }
