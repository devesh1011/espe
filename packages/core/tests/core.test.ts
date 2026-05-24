import { bytesToString, hexToBytes, stringToHex, toRlp } from "viem";
import { describe, expect, it } from "vitest";
import {
  ARKIV_BRAGA_CHAIN_ID,
  ARKIV_STORAGE_ADDRESS,
  buildAndSignArkivEntityCreate,
  buildAndSignSepoliaCall,
  chunkHexPayload,
  decodeFrame,
  encodeArkivStorageTransactionRlp,
  encodeGolemBaseStorageTransactionRlp,
  FrameReassembler,
  parseRawTransaction,
  recoverRawTransactionSender,
  SEPOLIA_CHAIN_ID,
} from "../src/index.js";

const testPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000001";
const testAddress = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

describe("storage transaction RLP", () => {
  it("encodes the current Arkiv SDK five-list create shape", () => {
    const actual = encodeArkivStorageTransactionRlp({
      creates: [
        {
          expiresInSeconds: 50,
          contentType: "application/json",
          payload: "foo",
          stringAnnotations: [{ key: "kind", value: "demo" }],
          numericAnnotations: [{ key: "ix", value: 1 }],
        },
      ],
    });

    const expected = toRlp([
      [
        [
          "0x19",
          stringToHex("application/json"),
          stringToHex("foo"),
          [[stringToHex("kind"), stringToHex("demo")]],
          [[stringToHex("ix"), "0x01"]],
        ],
      ],
      [],
      [],
      [],
      [],
    ]);

    expect(actual).toBe(expected);
  });

  it("encodes the documented GolemBase four-list compatibility shape", () => {
    const actual = encodeGolemBaseStorageTransactionRlp({
      creates: [{ expiresInSeconds: 4, contentType: "text/plain", payload: "bar" }],
    });

    expect(actual).toBe(toRlp([[["0x02", stringToHex("bar"), [], []]], [], [], []]));
  });
});

describe("frame codec", () => {
  it("chunks and reassembles raw tx sized payloads", () => {
    const raw = `0x${"ab".repeat(420)}` as const;
    const frames = chunkHexPayload(raw, 42, 96);
    expect(frames.length).toBeGreaterThan(1);
    expect(decodeFrame(frames[0] ?? new Uint8Array()).messageId).toBe(42);

    const reassembler = new FrameReassembler();
    let result: ReturnType<FrameReassembler["push"]>;
    for (const frame of frames) result = reassembler.push(frame);

    expect(bytesToString(result?.payload ?? new Uint8Array())).not.toBe(raw);
    expect(`0x${Buffer.from(result?.payload ?? []).toString("hex")}`).toBe(raw);
  });
});

describe("raw tx helpers", () => {
  it("signs, parses, and recovers a Sepolia transaction", async () => {
    const raw = await buildAndSignSepoliaCall({
      privateKey: testPrivateKey,
      nonce: 0,
      to: testAddress,
      valueEth: "0",
    });

    const parsed = parseRawTransaction(raw);
    expect(Number(parsed.chainId)).toBe(SEPOLIA_CHAIN_ID);
    expect(await recoverRawTransactionSender(raw)).toBe(testAddress);
  });

  it("signs, parses, and recovers an Arkiv entity-create transaction", async () => {
    const raw = await buildAndSignArkivEntityCreate({
      privateKey: testPrivateKey,
      nonce: 7,
      value: { ok: true },
      attributes: [{ key: "app", value: "espresso" }],
    });

    const parsed = parseRawTransaction(raw);
    expect(Number(parsed.chainId)).toBe(ARKIV_BRAGA_CHAIN_ID);
    expect(parsed.to).toBe(ARKIV_STORAGE_ADDRESS);
    expect(hexToBytes(parsed.data ?? "0x").length).toBeGreaterThan(0);
    expect(await recoverRawTransactionSender(raw)).toBe(testAddress);
  });
});
