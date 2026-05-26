import type { Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAndSignSepoliaCall,
  chunkHexPayload,
  chunkPayload,
  encodeSubmissionMessage,
} from "../../packages/core/src/index.js";
import {
  clearScheduledSubmissions,
  ingestFrameHex,
  recoverQueuedSubmissions,
  submissions,
} from "../../packages/ground-station/src/app.js";

const privateKey = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const account = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";
const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const auditEntityKey = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const env = {
  SEPOLIA_RPC_URL: "https://rpc.test/sepolia",
  ARKIV_RPC_URL: "https://rpc.test/arkiv",
  ARKIV_WS_URL: "wss://rpc.test/arkiv/ws",
  DEVICE_PRIVATE_KEY: privateKey,
  GROUND_STATION_PRIVATE_KEY: privateKey,
  GROUND_STATION_PORT: 8787,
  SERIAL_BAUD_RATE: 115_200,
  AUDIT_EXPIRES_DAYS: 30,
} as const;

afterEach(() => {
  clearScheduledSubmissions();
  vi.restoreAllMocks();
  vi.useRealTimers();
  submissions.clear();
});

type QueuedFixture = { entityKey: string; audit: Record<string, unknown> };

// Builds an arkiv_query RPC entity whose hex payload decodes to the audit JSON.
function queuedRpcEntity({ entityKey, audit }: QueuedFixture) {
  return {
    key: entityKey,
    value: `0x${Buffer.from(JSON.stringify(audit)).toString("hex")}`,
    contentType: "application/json",
    owner: account,
    creator: account,
    expiresAt: "0x100",
    createdAtBlock: "0x1",
    stringAttributes: [
      { key: "app", value: "espresso" },
      { key: "kind", value: "submission" },
      { key: "txHash", value: String(audit.txHash) },
      { key: "from", value: String(audit.from) },
      { key: "status", value: String(audit.status) },
    ],
    numericAttributes: [
      { key: "chainId", value: Number(audit.chainId) },
      { key: "submitAfter", value: Number(audit.submitAfter) },
    ],
  };
}

function mockRpc(queued: QueuedFixture[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    if (request.method === "arkiv_query") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { data: queued.map(queuedRpcEntity), cursor: undefined, blockNumber: "0x1" },
      });
    }
    if (request.method === "eth_sendRawTransaction") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: txHash });
    }
    if (request.method === "eth_getTransactionReceipt") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          transactionHash: txHash,
          blockHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          blockNumber: "0x1",
          contractAddress: null,
          cumulativeGasUsed: "0x5208",
          effectiveGasPrice: "0x1",
          from: account,
          gasUsed: "0x5208",
          logs: [
            {
              address: "0x00000000000000000000000000000061726b6976",
              blockHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              blockNumber: "0x1",
              data: "0x",
              logIndex: "0x0",
              removed: false,
              topics: ["0xce4b4ad6891d716d0b1fba2b4aeb05ec20edadb01df512263d0dde423736bbb9", auditEntityKey],
              transactionHash: txHash,
              transactionIndex: "0x0",
            },
          ],
          logsBloom: `0x${"0".repeat(512)}`,
          status: "0x1",
          to: "0x00000000000000000000000000000061726b6976",
          transactionIndex: "0x0",
          type: "0x0",
        },
      });
    }
    return Response.json({ jsonrpc: "2.0", id: 1, result: [] });
  });
}

describe("simulated radio path", () => {
  it("moves a core-signed tx through frame reassembly to Arkiv audit", async () => {
    mockRpc();
    const rawTx = await buildAndSignSepoliaCall({
      privateKey,
      nonce: 0,
      to: account,
    });
    const frames = chunkHexPayload(rawTx, 999, 96);

    let finalSubmission: Awaited<ReturnType<typeof ingestFrameHex>>;
    for (const frame of frames) {
      finalSubmission = await ingestFrameHex(`0x${Buffer.from(frame).toString("hex")}`, env);
    }

    expect(finalSubmission?.status).toBe("audited");
    expect(finalSubmission?.auditEntityKey).toBe(auditEntityKey);
    expect(finalSubmission?.from).toBe(account);
  });

  it("holds a scheduled tx until submitAfter passes, then submits and audits", async () => {
    mockRpc();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));

    const rawTx = await buildAndSignSepoliaCall({ privateKey, nonce: 1, to: account });
    const submitAfter = Math.floor(Date.now() / 1000) + 60;
    const envelope = encodeSubmissionMessage({ rawTx, submitAfter });
    const frames = chunkPayload(envelope, 1234, 96);

    let submission: Awaited<ReturnType<typeof ingestFrameHex>>;
    for (const frame of frames) {
      submission = await ingestFrameHex(`0x${Buffer.from(frame).toString("hex")}`, env);
    }

    expect(submission?.status).toBe("queued");
    expect(submission?.submitAfter).toBe(submitAfter);
    // The queued tx is persisted to Arkiv immediately, so its entity exists now.
    expect(submission?.auditEntityKey).toBe(auditEntityKey);

    await vi.advanceTimersByTimeAsync(61_000);

    expect(submission?.status).toBe("audited");
    expect(submission?.auditEntityKey).toBe(auditEntityKey);
  });

  it("recovers a queued tx from Arkiv on restart and submits it when due", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));

    const submitAfter = Math.floor(Date.now() / 1000) + 120;
    const queuedEntityKey = `0x${"dd".repeat(32)}`;
    const queuedTxHash = `0x${"ee".repeat(32)}`;
    const audit = {
      txHash: queuedTxHash,
      from: account,
      chainId: 11_155_111,
      rawTx: `0x02${"cc".repeat(20)}`,
      ts: new Date().toISOString(),
      submitAfter,
      status: "queued",
    };
    mockRpc([{ entityKey: queuedEntityKey, audit }]);

    const restored = await recoverQueuedSubmissions(env);

    expect(restored).toHaveLength(1);
    expect(restored[0]?.auditEntityKey).toBe(queuedEntityKey);
    expect(submissions.get(queuedTxHash)?.status).toBe("queued");

    await vi.advanceTimersByTimeAsync(121_000);

    expect(submissions.get(queuedTxHash)?.status).toBe("audited");
  });
});
