import { z } from "zod";
import { ARKIV_BRAGA_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../chains.js";

export const hexSchema = z.string().regex(/^0x([0-9a-fA-F]{2})*$/);

export const rawTransactionPayloadSchema = z.object({
  kind: z.literal("raw_tx"),
  chainId: z.union([z.literal(SEPOLIA_CHAIN_ID), z.literal(ARKIV_BRAGA_CHAIN_ID)]),
  rawTx: hexSchema,
  messageId: z.number().int().min(0).max(0xffffffff).optional(),
});

export const ingestResponseSchema = z.object({
  txHash: hexSchema,
  chainId: z.number().int(),
  from: hexSchema,
  status: z.enum(["submitted", "confirmed"]),
});

export type RawTransactionPayload = z.infer<typeof rawTransactionPayloadSchema>;
export type IngestResponse = z.infer<typeof ingestResponseSchema>;
