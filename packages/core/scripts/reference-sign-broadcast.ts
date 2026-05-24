import { type Address, createPublicClient, type Hex, http } from "viem";
import { sepolia } from "viem/chains";
import { arkivBraga, DEFAULT_ARKIV_RPC_URL, DEFAULT_SEPOLIA_RPC_URL } from "../src/chains.js";
import { loadEspressoEnv, requireEnvPrivateKey } from "../src/env.js";
import { buildAndSignArkivEntityCreate, buildAndSignSepoliaCall } from "../src/evm/tx.js";

const env = loadEspressoEnv();
const privateKey = requireEnvPrivateKey(env, "DEVICE_PRIVATE_KEY") as Hex;

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(env.SEPOLIA_RPC_URL ?? DEFAULT_SEPOLIA_RPC_URL),
});

const arkivClient = createPublicClient({
  chain: arkivBraga,
  transport: http(env.ARKIV_RPC_URL ?? DEFAULT_ARKIV_RPC_URL),
});

const to = (process.env.REFERENCE_SEPOLIA_TO ?? "0x0000000000000000000000000000000000000000") as Address;
const sepoliaNonce = Number(process.env.REFERENCE_SEPOLIA_NONCE ?? 0);
const arkivNonce = Number(process.env.REFERENCE_ARKIV_NONCE ?? 0);

const sepoliaRawTx = await buildAndSignSepoliaCall({
  privateKey,
  nonce: sepoliaNonce,
  to,
  valueEth: process.env.REFERENCE_SEPOLIA_VALUE_ETH ?? "0",
});

const arkivRawTx = await buildAndSignArkivEntityCreate({
  privateKey,
  nonce: arkivNonce,
  value: {
    app: "espresso",
    kind: "reference",
    createdAt: new Date().toISOString(),
  },
  attributes: [
    { key: "app", value: "espresso" },
    { key: "kind", value: "reference" },
  ],
});

console.log("Submitting Sepolia raw tx...");
const sepoliaHash = await sepoliaClient.sendRawTransaction({ serializedTransaction: sepoliaRawTx });
console.log({ chain: "sepolia", txHash: sepoliaHash, rawTx: sepoliaRawTx });

console.log("Submitting Arkiv Braga raw tx...");
const arkivHash = await arkivClient.sendRawTransaction({ serializedTransaction: arkivRawTx });
console.log({ chain: "arkiv-braga", txHash: arkivHash, rawTx: arkivRawTx });
