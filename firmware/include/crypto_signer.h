#pragma once

#include <Arduino.h>

struct Signature65 {
  uint8_t r[32];
  uint8_t s[32];
  uint8_t recoveryId;
};

bool hexToBytes(const String& hex, uint8_t* out, size_t outLen);
String bytesToHexString(const uint8_t* bytes, size_t length);
void keccak256(const uint8_t* data, size_t length, uint8_t out[32]);
bool signDigest(const String& privateKeyHex, const uint8_t digest[32], Signature65& signature);
