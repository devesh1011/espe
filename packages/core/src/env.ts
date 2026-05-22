import { z } from "zod";
import { DEFAULT_ARKIV_RPC_URL, DEFAULT_ARKIV_WS_URL, DEFAULT_SEPOLIA_RPC_URL } from "./chains.js";

const privateKeySchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Expected a 32-byte private key hex string");

export const espressoEnvSchema = z.object({
  SEPOLIA_RPC_URL: z.url().default(DEFAULT_SEPOLIA_RPC_URL),
  ARKIV_RPC_URL: z.url().default(DEFAULT_ARKIV_RPC_URL),
  ARKIV_WS_URL: z.url().default(DEFAULT_ARKIV_WS_URL),
  DEVICE_PRIVATE_KEY: privateKeySchema.optional(),
  GROUND_STATION_PRIVATE_KEY: privateKeySchema.optional(),
  GROUND_STATION_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  SERIAL_PORT_PATH: z.string().optional(),
  SERIAL_BAUD_RATE: z.coerce.number().int().positive().default(115_200),
  AUDIT_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),
});

export type EspressoEnv = z.infer<typeof espressoEnvSchema>;

export function loadEspressoEnv(source: NodeJS.ProcessEnv = process.env): EspressoEnv {
  return espressoEnvSchema.parse(source);
}

export function requireEnvPrivateKey(
  env: EspressoEnv,
  key: "DEVICE_PRIVATE_KEY" | "GROUND_STATION_PRIVATE_KEY",
) {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for this operation`);
  return value;
}
