#include <Arduino.h>
#include <Adafruit_SSD1306.h>
#include <RadioLib.h>

#include "arkiv_data.h"
#include "espresso_config.h"
#include "crypto_signer.h"
#include "evm_tx.h"
#include "key_store.h"
#include "lora_transport.h"
#include "satellite_transport.h"
#include "serial_transport.h"
#include "submission_message.h"

Adafruit_SSD1306 display(128, 64, &Wire, -1);
KeyStore keyStore;
DeviceIdentity identity;
bool loraReady = false;
bool satelliteReady = false;

void showStatus(const String& line1, const String& line2 = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Espresso");
  display.println(line1);
  if (line2.length() > 0) display.println(line2);
  display.display();
}

void setup() {
  Serial.begin(ESPRESSO_SERIAL_BAUD);
  Wire.begin();
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  loraReady = beginLoRa();
  satelliteReady = beginSatellite();

#ifdef ESPRESSO_ROLE_GROUND_RECEIVER
  showStatus("Ground receiver", satelliteReady ? "satellite ready" : "satellite offline");
  Serial.println("espresso ground receiver boot");
  Serial.println("frames from satellite will be forwarded as 0x hex lines");
  return;
#endif

  keyStore.begin();
  identity = keyStore.load();
  showStatus("Address", identity.address.substring(0, 21));
  Serial.println("espresso firmware boot");
  Serial.printf("address=%s sepoliaNonce=%lu arkivNonce=%lu\n", identity.address.c_str(), identity.sepoliaNonce, identity.arkivNonce);
  uint8_t digest[32];
  keccak256(reinterpret_cast<const uint8_t*>("espresso"), 8, digest);
  Serial.printf("selftestHash=%s\n", bytesToHexString(digest, 32).c_str());
  String sampleRawTx = signLegacyTransaction(sepoliaNoopTx(identity.sepoliaNonce, identity.address.substring(2)), identity.privateKeyHex);
  Serial.printf("sampleRawTx=%s\n", sampleRawTx.c_str());
  transmitRawTxSerial(sampleRawTx);
  if (loraReady) transmitRawTxLoRa(sampleRawTx);
  if (satelliteReady) transmitRawTxSatellite(sampleRawTx);
  showStatus(satelliteReady ? "Satellite tx sent" : loraReady ? "Serial+LoRa sent" : "Serial tx sent", identity.address.substring(0, 21));
  const ArkivAttribute attrs[] = {{"app", "espresso"}, {"kind", "firmware"}};
  Serial.printf("sampleArkivData=%s\n", arkivCreateJsonData("{\"ok\":true}", attrs, 2, 86400).c_str());
}

void loop() {
#ifdef ESPRESSO_ROLE_GROUND_RECEIVER
  String frameHex;
  if (receiveSatelliteFrame(frameHex)) {
    Serial.println(frameHex);
    showStatus("Satellite frame", "forwarded to host");
  }
  delay(5000);
  return;
#else
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.startsWith("VERIFY_SEPOLIA ")) {
      int p1 = command.indexOf(' ');
      int p2 = command.indexOf(' ', p1 + 1);
      int p3 = command.indexOf(' ', p2 + 1);
      String privateKey = command.substring(p1 + 1, p2);
      uint32_t nonce = command.substring(p2 + 1, p3).toInt();
      String to = command.substring(p3 + 1);
      String raw = signLegacyTransaction(sepoliaNoopTx(nonce, to), privateKey);
      Serial.println("RAW_TX " + raw);
    } else if (command == "SEND_SAMPLE") {
      String raw = signLegacyTransaction(sepoliaNoopTx(keyStore.nextSepoliaNonce(), identity.address.substring(2)), identity.privateKeyHex);
      transmitRawTxSerial(raw);
      if (loraReady) transmitRawTxLoRa(raw);
      if (satelliteReady) transmitRawTxSatellite(raw);
      Serial.println("SENT " + raw);
    } else if (command.startsWith("SEND_SCHEDULED ")) {
      // SEND_SCHEDULED <submitAfterUnixSeconds> — relays a sample tx the ground
      // station must hold until the given absolute unix time has passed.
      uint64_t submitAfter = strtoull(command.substring(command.indexOf(' ') + 1).c_str(), nullptr, 10);
      String raw = signLegacyTransaction(sepoliaNoopTx(keyStore.nextSepoliaNonce(), identity.address.substring(2)), identity.privateKeyHex);
      String message = buildSubmissionMessageHex(raw, submitAfter);
      transmitRawTxSerial(message);
      if (loraReady) transmitRawTxLoRa(message);
      if (satelliteReady) transmitRawTxSatellite(message);
      Serial.printf("SCHEDULED submitAfter=%llu %s\n", submitAfter, raw.c_str());
    }
  }
  delay(1000);
#endif
}
