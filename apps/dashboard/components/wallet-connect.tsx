"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: "accountsChanged" | "chainChanged",
    listener: (...args: unknown[]) => void,
  ) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function chainLabel(chainId?: string) {
  if (!chainId) return "";
  const id = Number.parseInt(chainId, 16);
  if (id === 11155111) return "Sepolia";
  if (id === 60138453102) return "Arkiv";
  return `Chain ${id}`;
}

export function WalletConnect() {
  const [address, setAddress] = useState<string>();
  const [chainId, setChainId] = useState<string>();
  const [status, setStatus] = useState<"idle" | "connecting" | "missing" | "error">("idle");

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;

    void provider.request({ method: "eth_accounts" }).then((accounts) => {
      const [account] = accounts as string[];
      if (account) setAddress(account);
    });
    void provider.request({ method: "eth_chainId" }).then((nextChainId) => {
      if (typeof nextChainId === "string") setChainId(nextChainId);
    });

    const handleAccounts = (...args: unknown[]) => {
      const [accounts] = args as [string[]];
      setAddress(accounts[0]);
    };
    const handleChain = (...args: unknown[]) => {
      const [nextChainId] = args as [string];
      setChainId(nextChainId);
    };

    provider.on?.("accountsChanged", handleAccounts);
    provider.on?.("chainChanged", handleChain);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccounts);
      provider.removeListener?.("chainChanged", handleChain);
    };
  }, []);

  async function connect() {
    const provider = window.ethereum;
    if (!provider) {
      setStatus("missing");
      return;
    }

    setStatus("connecting");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const nextChainId = await provider.request({ method: "eth_chainId" });
      setAddress(accounts[0]);
      if (typeof nextChainId === "string") setChainId(nextChainId);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const label = address ? shortAddress(address) : status === "connecting" ? "Connecting" : "Connect";
  const subtitle = address
    ? chainLabel(chainId)
    : status === "missing"
      ? "No injected wallet found"
      : status === "error"
        ? "Connection rejected"
        : "Operator wallet";

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-zinc-400 text-xs">{subtitle}</p>
      </div>
      <Button
        variant="outline"
        onClick={() => void connect()}
        disabled={status === "connecting"}
        title="Connects your browser wallet for operator identity only; Espresso submissions are signed offline."
      >
        <Wallet size={16} />
        {label}
      </Button>
    </div>
  );
}
