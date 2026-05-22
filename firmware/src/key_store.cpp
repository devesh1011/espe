#include "key_store.h"

namespace {
String bytesToHex(const uint8_t* bytes, size_t length) {
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    out += hex[(bytes[i] >> 4) & 0x0f];
    out += hex[bytes[i] & 0x0f];
  }
  return out;
}
}  // namespace

void KeyStore::begin() {
  prefs_.begin("espresso", false);
}

String KeyStore::ensurePrivateKey() {
  String existing = prefs_.getString("priv", "");
  if (existing.length() == 64) return existing;

  uint8_t key[32];
  for (uint8_t& byte : key) byte = static_cast<uint8_t>(esp_random() & 0xff);
  String generated = bytesToHex(key, sizeof(key));
  prefs_.putString("priv", generated);
  prefs_.putUInt("sepNonce", 0);
  prefs_.putUInt("arkNonce", 0);
  return generated;
}

String KeyStore::deriveAddress(const String& privateKeyHex) {
  // Replaced by full secp256k1 public-key derivation in the signing module.
  return "0x" + privateKeyHex.substring(24, 64);
}

DeviceIdentity KeyStore::load() {
  const String privateKey = ensurePrivateKey();
  return {
      .privateKeyHex = privateKey,
      .address = deriveAddress(privateKey),
      .sepoliaNonce = prefs_.getUInt("sepNonce", 0),
      .arkivNonce = prefs_.getUInt("arkNonce", 0),
  };
}

uint32_t KeyStore::nextSepoliaNonce() {
  const uint32_t nonce = prefs_.getUInt("sepNonce", 0);
  prefs_.putUInt("sepNonce", nonce + 1);
  return nonce;
}

uint32_t KeyStore::nextArkivNonce() {
  const uint32_t nonce = prefs_.getUInt("arkNonce", 0);
  prefs_.putUInt("arkNonce", nonce + 1);
  return nonce;
}
