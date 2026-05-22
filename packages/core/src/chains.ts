import { type Chain, defineChain } from "viem";
import { sepolia } from "viem/chains";

export const SEPOLIA_CHAIN_ID = 11_155_111;
export const ARKIV_BRAGA_CHAIN_ID = 60_138_453_102;

export const DEFAULT_SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const DEFAULT_ARKIV_RPC_URL = "https://braga.hoodi.arkiv.network/rpc";
export const DEFAULT_ARKIV_WS_URL = "wss://braga.hoodi.arkiv.network/rpc/ws";
export const ARKIV_BRIDGE_ADDRESS = "0xB52b417A79c9dE21ffe221dF9a3821B7EaC60813";
export const ARKIV_STORAGE_ADDRESS = "0x00000000000000000000000000000061726b6976";
export const GOLEMBASE_STORAGE_ADDRESS = "0x0000000000000000000000000000000060138453";

export const arkivBraga = defineChain({
  id: ARKIV_BRAGA_CHAIN_ID,
  name: "Arkiv Braga",
  network: "arkiv-braga",
  nativeCurrency: {
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [DEFAULT_ARKIV_RPC_URL],
      webSocket: [DEFAULT_ARKIV_WS_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Arkiv Braga Explorer",
      url: "https://explorer.braga.hoodi.arkiv.network",
    },
  },
  testnet: true,
});

export const supportedChains = {
  sepolia,
  arkivBraga,
} as const satisfies Record<string, Chain>;

export type SupportedChainId = typeof SEPOLIA_CHAIN_ID | typeof ARKIV_BRAGA_CHAIN_ID;

export function chainForId(chainId: number | bigint): Chain {
  const id = Number(chainId);
  if (id === SEPOLIA_CHAIN_ID) return sepolia;
  if (id === ARKIV_BRAGA_CHAIN_ID) return arkivBraga;
  throw new Error(`Unsupported chainId ${id}`);
}

export function rpcUrlForChainId(
  chainId: number | bigint,
  urls: { sepoliaRpcUrl?: string; arkivRpcUrl?: string } = {},
): string {
  const id = Number(chainId);
  if (id === SEPOLIA_CHAIN_ID) return urls.sepoliaRpcUrl ?? DEFAULT_SEPOLIA_RPC_URL;
  if (id === ARKIV_BRAGA_CHAIN_ID) return urls.arkivRpcUrl ?? DEFAULT_ARKIV_RPC_URL;
  throw new Error(`Unsupported chainId ${id}`);
}
