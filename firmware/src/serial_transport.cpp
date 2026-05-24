#include "serial_transport.h"

#include "espresso_config.h"
#include "frame_codec.h"
#include "rlp_encoder.h"

void transmitRawTxSerial(const String& rawTxHex) {
  const Bytes payload = hexToVector(rawTxHex);
  const uint32_t messageId = esp_random();
  const std::vector<Bytes> frames = chunkPayload(payload, messageId, ESPRESSO_RADIO_MTU);
  for (const Bytes& frame : frames) {
    Serial.println("0x" + vectorToHex(frame));
    delay(10);
  }
}
