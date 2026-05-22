#include "arkiv_data.h"

#include "rlp_encoder.h"

namespace {
Bytes asciiBytes(const String& value) {
  Bytes out;
  out.reserve(value.length());
  for (size_t i = 0; i < value.length(); i++) out.push_back(static_cast<uint8_t>(value[i]));
  return out;
}

Bytes annotationList(const ArkivAttribute* attributes, size_t attributeCount) {
  std::vector<Bytes> encoded;
  encoded.reserve(attributeCount);
  for (size_t i = 0; i < attributeCount; i++) {
    encoded.push_back(rlpList({
        rlpBytes(asciiBytes(attributes[i].key)),
        rlpBytes(asciiBytes(attributes[i].value)),
    }));
  }
  return rlpList(encoded);
}
}  // namespace

String arkivCreateJsonData(const String& jsonPayload, const ArkivAttribute* attributes, size_t attributeCount, uint32_t expiresInSeconds) {
  const uint32_t blocksToLive = (expiresInSeconds + 1) / 2;
  Bytes create = rlpList({
      rlpUint(blocksToLive),
      rlpBytes(asciiBytes("application/json")),
      rlpBytes(asciiBytes(jsonPayload)),
      annotationList(attributes, attributeCount),
      rlpList({}),
  });

  Bytes storageTx = rlpList({
      rlpList({create}),
      rlpList({}),
      rlpList({}),
      rlpList({}),
      rlpList({}),
  });

  return "0x" + vectorToHex(storageTx);
}
