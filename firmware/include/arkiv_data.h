#pragma once

#include <Arduino.h>

struct ArkivAttribute {
  String key;
  String value;
};

String arkivCreateJsonData(const String& jsonPayload, const ArkivAttribute* attributes, size_t attributeCount, uint32_t expiresInSeconds);
