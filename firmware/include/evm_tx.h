#pragma once

#include <Arduino.h>

struct LegacyTxRequest {
  uint64_t chainId;
  uint32_t nonce;
  uint64_t gasPriceWei;
  uint64_t gasLimit;
  String toHex20;
  uint64_t valueWei;
  String dataHex;
};

String signLegacyTransaction(const LegacyTxRequest& tx, const String& privateKeyHex);
LegacyTxRequest sepoliaNoopTx(uint32_t nonce, const String& toHex20);
