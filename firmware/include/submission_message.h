#pragma once

#include <Arduino.h>

#include "rlp_encoder.h"

// Wraps a signed raw transaction hex in the Espresso submission envelope.
// When submitAfter > 0 it is encoded as a big-endian uint64 unix-seconds field
// and the ground station holds the transaction until that time has passed.
// When submitAfter == 0 the envelope carries no schedule (submit immediately).
String buildSubmissionMessageHex(const String& rawTxHex, uint64_t submitAfter);
