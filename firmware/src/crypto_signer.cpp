#include "crypto_signer.h"

#include <SHA3.h>
#include <uECC.h>

namespace {
uint8_t fromHex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return 0;
}
}  // namespace

bool hexToBytes(const String& hex, uint8_t* out, size_t outLen) {
  String clean = hex;
  if (clean.startsWith("0x")) clean = clean.substring(2);
  if (clean.length() != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    out[i] = static_cast<uint8_t>((fromHex(clean[i * 2]) << 4) | fromHex(clean[i * 2 + 1]));
  }
  return true;
}

String bytesToHexString(const uint8_t* bytes, size_t length) {
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out += hex[(bytes[i] >> 4) & 0x0f];
    out += hex[bytes[i] & 0x0f];
  }
  return out;
}

void keccak256(const uint8_t* data, size_t length, uint8_t out[32]) {
  SHA3_256 hasher;
  hasher.reset();
  hasher.update(data, length);
  hasher.finalize(out, 32);
}

bool signDigest(const String& privateKeyHex, const uint8_t digest[32], Signature65& signature) {
  uint8_t privateKey[32];
  if (!hexToBytes(privateKeyHex, privateKey, sizeof(privateKey))) return false;

  uint8_t sig[64];
  const uECC_Curve curve = uECC_secp256k1();
  if (!uECC_sign(privateKey, digest, 32, sig, curve)) return false;

  memcpy(signature.r, sig, 32);
  memcpy(signature.s, sig + 32, 32);
  signature.recoveryId = 0;
  return true;
}
