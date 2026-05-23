import { createPublicClient, createWalletClient, type Hex, http } from "@arkiv-network/sdk";
import { privateKeyToAccount } from "@arkiv-network/sdk/accounts";
import { braga } from "@arkiv-network/sdk/chains";
import { eq, lte } from "@arkiv-network/sdk/query";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { z } from "zod";
import { DEFAULT_ARKIV_RPC_URL } from "../chains.js";

// Best practice #1: every entity carries a globally-unique project attribute so
// our data is distinguishable from every other app sharing the Arkiv network,
// and every query filters on it.
export const PROJECT_ATTRIBUTE = { key: "project", value: "espresso-ns05-arkiv" } as const;
// Three entity types share the project namespace, distinguished by `kind`.
export const SUBMISSION_KIND = { key: "kind", value: "submission" } as const;
export const DEVICE_KIND = { key: "kind", value: "device" } as const;
export const RECEIPT_KIND = { key: "kind", value: "receipt" } as const;

// The status attribute reflects the relayed tx lifecycle, updated in place on a
// single entity: queued (scheduled, awaiting its time) → submitted (broadcast)
// → confirmed (mined ok) / failed (broadcast error or reverted).
export const SUBMISSION_STATUSES = ["queued", "submitted", "confirmed", "failed"] as const;
export type SubmissionEntityStatus = (typeof SUBMISSION_STATUSES)[number];

// Best practice #14: validate entity payloads with a schema — toJson() is `any`.
// `deviceKey` is the foreign key to the device entity that signed this tx.
export const auditEntitySchema = z.object({
  txHash: z.string(),
  from: z.string(),
  chainId: z.number(),
  rawTx: z.string(),
  ts: z.string(),
  submitAfter: z.number().optional(),
  deviceKey: z.string().optional(),
  status: z.enum(SUBMISSION_STATUSES),
});

export type AuditEntity = z.infer<typeof auditEntitySchema>;

// Second entity type: a device that has relayed through this station. Submissions
// reference it via a shared `deviceKey` attribute (parent → child relationship).
export const deviceEntitySchema = z.object({
  address: z.string(),
  label: z.string(),
  firstSeenTs: z.string(),
});

export type DeviceEntity = z.infer<typeof deviceEntitySchema>;

// Third entity type: a terminal receipt of a relayed tx. The station creates it,
// then transfers $owner to the submitting user — so the user owns their data,
// while $creator stays the station (immutable, tamper-proof attribution).
export const RECEIPT_STATUSES = ["confirmed", "failed"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const receiptEntitySchema = z.object({
  txHash: z.string(),
  from: z.string(),
  chainId: z.number(),
  status: z.enum(RECEIPT_STATUSES),
  ts: z.string(),
  // Foreign keys: the submission this receipt finalizes, and the device.
  submissionKey: z.string(),
  blockNumber: z.number().optional(),
  deviceKey: z.string().optional(),
});

export type ReceiptEntity = z.infer<typeof receiptEntitySchema>;

export type ArkivWriteOptions = {
  privateKey: Hex;
  rpcUrl?: string;
  expiresInDays?: number;
};

export type ArkivEntityWriteResult = {
  entityKey: Hex;
  txHash: Hex;
};

// Best practice #2: separate read and write clients. These stay internal so the
// public surface only exposes intent-level helpers.
function arkivPublicClient(rpcUrl: string = DEFAULT_ARKIV_RPC_URL) {
  return createPublicClient({ chain: braga, transport: http(rpcUrl) });
}

function arkivWalletClient(privateKey: Hex, rpcUrl: string = DEFAULT_ARKIV_RPC_URL) {
  return createWalletClient({
    chain: braga,
    transport: http(rpcUrl),
    account: privateKeyToAccount(privateKey),
  });
}

// Best practice #3 & #9: attributes are indexes; store numbers as numbers so
// chainId/submitAfter support range queries (e.g. submitAfter <= now).
function submissionAttributes(audit: AuditEntity) {
  const attributes: Array<{ key: string; value: string | number }> = [
    PROJECT_ATTRIBUTE,
    SUBMISSION_KIND,
    { key: "txHash", value: audit.txHash },
    { key: "from", value: audit.from },
    { key: "chainId", value: audit.chainId },
    { key: "status", value: audit.status },
  ];
  if (audit.submitAfter !== undefined) {
    attributes.push({ key: "submitAfter", value: audit.submitAfter });
  }
  if (audit.deviceKey !== undefined) {
    attributes.push({ key: "deviceKey", value: audit.deviceKey });
  }
  return attributes;
}

export async function createSubmissionEntity(
  audit: AuditEntity,
  options: ArkivWriteOptions,
): Promise<ArkivEntityWriteResult> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(audit),
    contentType: "application/json",
    attributes: submissionAttributes(audit),
    expiresIn: ExpirationTime.fromDays(options.expiresInDays ?? 30),
  });
  return { entityKey, txHash: txHash as Hex };
}

// Best practice: status transitions use updateEntity so the queued entity
// becomes the submitted/failed record instead of accumulating duplicates.
export async function updateSubmissionEntity(
  entityKey: Hex,
  audit: AuditEntity,
  options: ArkivWriteOptions,
): Promise<ArkivEntityWriteResult> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { txHash } = await client.updateEntity({
    entityKey,
    payload: jsonToPayload(audit),
    contentType: "application/json",
    attributes: submissionAttributes(audit),
    expiresIn: ExpirationTime.fromDays(options.expiresInDays ?? 30),
  });
  return { entityKey, txHash: txHash as Hex };
}

export type RecoveredSubmission = {
  entityKey: Hex;
  audit: AuditEntity;
};

// Recovery query for the durable queue. Best practice #5: specific query (project
// + kind + status). Best practice #12: createdBy filter so we only trust queued
// entities our own ground station wallet wrote — no one can inject fake work.
export async function queryQueuedSubmissions(options: {
  trustedCreator: Hex;
  rpcUrl?: string;
  dueBefore?: number;
}): Promise<RecoveredSubmission[]> {
  const client = arkivPublicClient(options.rpcUrl);
  const predicates = [
    eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value),
    eq(SUBMISSION_KIND.key, SUBMISSION_KIND.value),
    eq("status", "queued"),
  ];
  if (options.dueBefore !== undefined) {
    predicates.push(lte("submitAfter", options.dueBefore));
  }
  const result = await client
    .buildQuery()
    .where(predicates)
    .createdBy(options.trustedCreator)
    .withPayload(true)
    .withAttributes(true)
    .fetch();

  return result.entities.flatMap((entity) => {
    const parsed = auditEntitySchema.safeParse(entity.toJson());
    if (!parsed.success) return [];
    return [{ entityKey: entity.key, audit: parsed.data }];
  });
}

function deviceAttributes(device: DeviceEntity) {
  return [PROJECT_ATTRIBUTE, DEVICE_KIND, { key: "address", value: device.address }];
}

// Device entities are long-lived registry records (differentiated TTL from the
// 30-day submission entities), so they persist across many relays.
export async function createDeviceEntity(
  device: DeviceEntity,
  options: ArkivWriteOptions,
): Promise<ArkivEntityWriteResult> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(device),
    contentType: "application/json",
    attributes: deviceAttributes(device),
    expiresIn: ExpirationTime.fromDays(365),
  });
  return { entityKey, txHash: txHash as Hex };
}

export async function findDeviceEntityByAddress(
  address: string,
  options: { trustedCreator: Hex; rpcUrl?: string },
): Promise<Hex | undefined> {
  const client = arkivPublicClient(options.rpcUrl);
  const result = await client
    .buildQuery()
    .where([
      eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value),
      eq(DEVICE_KIND.key, DEVICE_KIND.value),
      eq("address", address),
    ])
    .createdBy(options.trustedCreator)
    .withAttributes(true)
    .limit(1)
    .fetch();
  return result.entities[0]?.key;
}

export type DeviceRecord = {
  entityKey: Hex;
  device: DeviceEntity;
};

export async function queryDeviceEntities(options: {
  trustedCreator: Hex;
  rpcUrl?: string;
}): Promise<DeviceRecord[]> {
  const client = arkivPublicClient(options.rpcUrl);
  const result = await client
    .buildQuery()
    .where([eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value), eq(DEVICE_KIND.key, DEVICE_KIND.value)])
    .createdBy(options.trustedCreator)
    .withPayload(true)
    .withAttributes(true)
    .fetch();

  return result.entities.flatMap((entity) => {
    const parsed = deviceEntitySchema.safeParse(entity.toJson());
    if (!parsed.success) return [];
    return [{ entityKey: entity.key, device: parsed.data }];
  });
}

function receiptAttributes(receipt: ReceiptEntity) {
  const attributes: Array<{ key: string; value: string | number }> = [
    PROJECT_ATTRIBUTE,
    RECEIPT_KIND,
    { key: "txHash", value: receipt.txHash },
    { key: "from", value: receipt.from },
    { key: "chainId", value: receipt.chainId },
    { key: "status", value: receipt.status },
    { key: "submissionKey", value: receipt.submissionKey },
  ];
  if (receipt.blockNumber !== undefined) {
    attributes.push({ key: "blockNumber", value: receipt.blockNumber });
  }
  if (receipt.deviceKey !== undefined) {
    attributes.push({ key: "deviceKey", value: receipt.deviceKey });
  }
  return attributes;
}

export async function createReceiptEntity(
  receipt: ReceiptEntity,
  options: ArkivWriteOptions,
): Promise<ArkivEntityWriteResult> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(receipt),
    contentType: "application/json",
    attributes: receiptAttributes(receipt),
    expiresIn: ExpirationTime.fromDays(90),
  });
  return { entityKey, txHash: txHash as Hex };
}

// Hands an entity to a new owner. Used to give the user the receipt for their tx.
export async function changeEntityOwner(
  entityKey: Hex,
  newOwner: Hex,
  options: ArkivWriteOptions,
): Promise<Hex> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { txHash } = await client.changeOwnership({ entityKey, newOwner });
  return txHash as Hex;
}

// Extends an entity's lifespan — e.g. keep a failed submission around longer for
// investigation instead of letting it expire on the default schedule.
export async function extendEntityExpiry(
  entityKey: Hex,
  days: number,
  options: ArkivWriteOptions,
): Promise<Hex> {
  const client = arkivWalletClient(options.privateKey, options.rpcUrl);
  const { txHash } = await client.extendEntity({ entityKey, expiresIn: ExpirationTime.fromDays(days) });
  return txHash as Hex;
}

export type ReceiptRecord = {
  entityKey: Hex;
  receipt: ReceiptEntity;
};

// A user can list the receipts they own — proof that "users own their data".
export async function queryReceiptsByOwner(
  owner: Hex,
  options: { rpcUrl?: string } = {},
): Promise<ReceiptRecord[]> {
  const client = arkivPublicClient(options.rpcUrl);
  const result = await client
    .buildQuery()
    .where([eq(PROJECT_ATTRIBUTE.key, PROJECT_ATTRIBUTE.value), eq(RECEIPT_KIND.key, RECEIPT_KIND.value)])
    .ownedBy(owner)
    .withPayload(true)
    .withAttributes(true)
    .fetch();

  return result.entities.flatMap((entity) => {
    const parsed = receiptEntitySchema.safeParse(entity.toJson());
    if (!parsed.success) return [];
    return [{ entityKey: entity.key, receipt: parsed.data }];
  });
}

export type ArkivQueryResult = {
  key: Hex;
  value: string;
};

// Freeform query used by the console's audit explorer. Goes through the SDK's
// raw string query so operators (&&, =, ~, range) keep working as typed.
export async function queryAuditEntities(
  query = 'project="espresso-ns05-arkiv" && kind="submission"',
  options: { rpcUrl?: string } = {},
): Promise<ArkivQueryResult[]> {
  const client = arkivPublicClient(options.rpcUrl);
  const { entities } = await client.query(query);
  return entities.map((entity) => ({ key: entity.key, value: entity.toText() }));
}
