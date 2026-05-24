#include "evm_tx.h"

#include "crypto_signer.h"
#include "espresso_config.h"
#include "rlp_encoder.h"

namespace {
Bytes legacyUnsignedPayload(const LegacyTxRequest& tx) {
  return rlpList({
      rlpUint(tx.nonce),
      rlpUint(tx.gasPriceWei),
      rlpUint(tx.gasLimit),
      rlpString(tx.toHex20),
      rlpUint(tx.valueWei),
      rlpString(tx.dataHex),
      rlpUint(tx.chainId),
      rlpUint(0),
      rlpUint(0),
  });
}
}  // namespace

String signLegacyTransaction(const LegacyTxRequest& tx, const String& privateKeyHex) {
  Bytes unsignedPayload = legacyUnsignedPayload(tx);
  uint8_t digest[32];
  keccak256(unsignedPayload.data(), unsignedPayload.size(), digest);

  Signature65 signature;
  if (!signDigest(privateKeyHex, digest, signature)) return "";

  uint64_t v = tx.chainId * 2 + 35 + signature.recoveryId;
  Bytes signedPayload = rlpList({
      rlpUint(tx.nonce),
      rlpUint(tx.gasPriceWei),
      rlpUint(tx.gasLimit),
      rlpString(tx.toHex20),
      rlpUint(tx.valueWei),
      rlpString(tx.dataHex),
      rlpUint(v),
      rlpBytes(Bytes(signature.r, signature.r + 32)),
      rlpBytes(Bytes(signature.s, signature.s + 32)),
  });

  return "0x" + vectorToHex(signedPayload);
}

LegacyTxRequest sepoliaNoopTx(uint32_t nonce, const String& toHex20) {
  return {
      .chainId = ESPRESSO_SEPOLIA_CHAIN_ID,
      .nonce = nonce,
      .gasPriceWei = 2000000000ULL,
      .gasLimit = 80000,
      .toHex20 = toHex20,
      .valueWei = 0,
      .dataHex = "",
  };
}
