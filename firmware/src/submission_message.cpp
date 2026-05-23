#include "submission_message.h"

namespace {
constexpr uint8_t SUBMISSION_ENVELOPE_MAGIC = 0xE7;
constexpr uint8_t SUBMISSION_ENVELOPE_VERSION = 1;
constexpr uint8_t FLAG_HAS_SUBMIT_AFTER = 0x01;
}  // namespace

String buildSubmissionMessageHex(const String& rawTxHex, uint64_t submitAfter) {
  const Bytes rawTx = hexToVector(rawTxHex);
  const bool hasSubmitAfter = submitAfter > 0;

  Bytes out;
  out.reserve(3 + (hasSubmitAfter ? 8 : 0) + rawTx.size());
  out.push_back(SUBMISSION_ENVELOPE_MAGIC);
  out.push_back(SUBMISSION_ENVELOPE_VERSION);
  out.push_back(hasSubmitAfter ? FLAG_HAS_SUBMIT_AFTER : 0);
  if (hasSubmitAfter) {
    for (int shift = 56; shift >= 0; shift -= 8) {
      out.push_back(static_cast<uint8_t>((submitAfter >> shift) & 0xFF));
    }
  }
  out.insert(out.end(), rawTx.begin(), rawTx.end());
  return vectorToHex(out);
}
