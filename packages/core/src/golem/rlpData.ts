import { brotliCompressSync } from "node:zlib";
import { type Hex, numberToHex, stringToHex, toBytes, toHex, toRlp } from "viem";
import { ARKIV_STORAGE_ADDRESS, GOLEMBASE_STORAGE_ADDRESS } from "../chains.js";

export type StringAnnotation = { key: string; value: string };
export type NumericAnnotation = { key: string; value: number | bigint };

export type ArkivCreate = {
  payload: Uint8Array | Hex | string;
  contentType: string;
  expiresInSeconds: number;
  stringAnnotations?: StringAnnotation[];
  numericAnnotations?: NumericAnnotation[];
};

export type ArkivUpdate = ArkivCreate & {
  entityKey: Hex;
};

export type ArkivExtend = {
  entityKey: Hex;
  expiresInSeconds: number;
};

export type ArkivOwnershipChange = {
  entityKey: Hex;
  newOwner: Hex;
};

export type ArkivStorageTransaction = {
  creates?: ArkivCreate[];
  updates?: ArkivUpdate[];
  deletes?: Hex[];
  extends?: ArkivExtend[];
  ownershipChanges?: ArkivOwnershipChange[];
};

export const ARKIV_BLOCK_TIME_SECONDS = 2;

function payloadToHex(payload: Uint8Array | Hex | string): Hex {
  if (payload instanceof Uint8Array) return toHex(payload);
  if (payload.startsWith("0x")) return payload as Hex;
  return stringToHex(payload);
}

function secondsToBlocksHex(seconds: number): Hex {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("Expiration seconds must be a positive integer");
  }
  return numberToHex(Math.ceil(seconds / ARKIV_BLOCK_TIME_SECONDS));
}

function formatStringAnnotations(annotations: StringAnnotation[] = []): [Hex, Hex][] {
  return annotations.map((annotation) => [stringToHex(annotation.key), stringToHex(annotation.value)]);
}

function formatNumericAnnotations(annotations: NumericAnnotation[] = []): [Hex, Hex][] {
  return annotations.map((annotation) => [stringToHex(annotation.key), numberToHex(annotation.value)]);
}

/**
 * Arkiv Braga currently follows the Arkiv SDK tx shape:
 * [creates, updates, deletes, extends, ownershipChanges], sent to 0x...61726b6976
 * after Brotli compression. Source: @arkiv-network/sdk v0.3.1
 * src/utils/arkivTransactions.ts and src/consts.ts.
 *
 * GolemBase JSON-RPC docs describe the older four-list shape and storage address
 * 0x...60138453 at https://docs.golemdb.io/dev/json-rpc-api/.
 */
export function encodeArkivStorageTransactionRlp(tx: ArkivStorageTransaction): Hex {
  const creates = (tx.creates ?? []).map((item) => [
    secondsToBlocksHex(item.expiresInSeconds),
    stringToHex(item.contentType),
    payloadToHex(item.payload),
    formatStringAnnotations(item.stringAnnotations),
    formatNumericAnnotations(item.numericAnnotations),
  ]);

  const updates = (tx.updates ?? []).map((item) => [
    item.entityKey,
    stringToHex(item.contentType),
    secondsToBlocksHex(item.expiresInSeconds),
    payloadToHex(item.payload),
    formatStringAnnotations(item.stringAnnotations),
    formatNumericAnnotations(item.numericAnnotations),
  ]);

  const extensions = (tx.extends ?? []).map((item) => [
    item.entityKey,
    secondsToBlocksHex(item.expiresInSeconds),
  ]);

  const ownershipChanges = (tx.ownershipChanges ?? []).map((item) => [item.entityKey, item.newOwner]);

  return toRlp([creates, updates, tx.deletes ?? [], extensions, ownershipChanges]);
}

export function encodeArkivStorageTransactionData(tx: ArkivStorageTransaction): Hex {
  return toHex(brotliCompressSync(toBytes(encodeArkivStorageTransactionRlp(tx))));
}

export function arkivCreateJsonData({
  value,
  contentType = "application/json",
  expiresInDays = 30,
  attributes = [],
}: {
  value: object;
  contentType?: string;
  expiresInDays?: number;
  attributes?: Array<StringAnnotation | NumericAnnotation>;
}): Hex {
  return encodeArkivStorageTransactionData({
    creates: [
      {
        payload: new TextEncoder().encode(JSON.stringify(value)),
        contentType,
        expiresInSeconds: expiresInDays * 24 * 60 * 60,
        stringAnnotations: attributes.filter(
          (item): item is StringAnnotation => typeof item.value === "string",
        ),
        numericAnnotations: attributes.filter(
          (item): item is NumericAnnotation => typeof item.value === "number",
        ),
      },
    ],
  });
}

export function encodeGolemBaseStorageTransactionRlp(
  tx: Omit<ArkivStorageTransaction, "ownershipChanges">,
): Hex {
  const creates = (tx.creates ?? []).map((item) => [
    secondsToBlocksHex(item.expiresInSeconds),
    payloadToHex(item.payload),
    formatStringAnnotations(item.stringAnnotations),
    formatNumericAnnotations(item.numericAnnotations),
  ]);
  const updates = (tx.updates ?? []).map((item) => [
    item.entityKey,
    secondsToBlocksHex(item.expiresInSeconds),
    payloadToHex(item.payload),
    formatStringAnnotations(item.stringAnnotations),
    formatNumericAnnotations(item.numericAnnotations),
  ]);
  const extensions = (tx.extends ?? []).map((item) => [
    item.entityKey,
    secondsToBlocksHex(item.expiresInSeconds),
  ]);
  return toRlp([creates, updates, tx.deletes ?? [], extensions]);
}

export const arkivStorageTarget = ARKIV_STORAGE_ADDRESS;
export const golemBaseStorageTarget = GOLEMBASE_STORAGE_ADDRESS;
