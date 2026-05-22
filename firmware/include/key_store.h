#pragma once

#include <Arduino.h>
#include <Preferences.h>

struct DeviceIdentity {
  String privateKeyHex;
  String address;
  uint32_t sepoliaNonce;
  uint32_t arkivNonce;
};

class KeyStore {
 public:
  void begin();
  DeviceIdentity load();
  uint32_t nextSepoliaNonce();
  uint32_t nextArkivNonce();

 private:
  Preferences prefs_;
  String ensurePrivateKey();
  String deriveAddress(const String& privateKeyHex);
};
