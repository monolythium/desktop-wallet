import { useEffect, useState } from "react";
import { addressToTypedBech32 } from "@monolythium/core-sdk";
import { loadCatalog } from "./vaultCatalog";

const ACTIVE_WALLET_EVENT = "wallet:active-wallet-changed";

export type ActiveWallet =
  | {
      status: "ready";
      slot: string;
      name: string;
      addressHex: string;
      address: string;
    }
  | {
      status: "locked";
      slot: string;
      name: string;
      addressHex: null;
      address: null;
    }
  | { status: "none"; slot: null; name: null; addressHex: null; address: null }
  | { status: "error"; slot: null; name: null; addressHex: null; address: null; error: string };

export function notifyActiveWalletChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ACTIVE_WALLET_EVENT));
}

export async function loadActiveWallet(): Promise<ActiveWallet> {
  if (!isTauri()) return emptyWallet();
  try {
    const catalog = await loadCatalog();
    const slot = catalog.activeSlot;
    if (!slot) return emptyWallet();
    const entry = catalog.vaults[slot];
    if (!entry) return emptyWallet();
    if (!entry.addressHex) {
      return {
        status: "locked",
        slot: entry.slot,
        name: entry.name,
        addressHex: null,
        address: null,
      };
    }
    return {
      status: "ready",
      slot: entry.slot,
      name: entry.name,
      addressHex: entry.addressHex,
      address: addressToTypedBech32("user", entry.addressHex),
    };
  } catch (cause) {
    return {
      status: "error",
      slot: null,
      name: null,
      addressHex: null,
      address: null,
      error: (cause as Error)?.message ?? String(cause),
    };
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useActiveWallet(): ActiveWallet {
  const [wallet, setWallet] = useState<ActiveWallet>(() => emptyWallet());

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void loadActiveWallet().then((next) => {
        if (!cancelled) setWallet(next);
      });
    };
    refresh();
    window.addEventListener(ACTIVE_WALLET_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ACTIVE_WALLET_EVENT, refresh);
    };
  }, []);

  return wallet;
}

function emptyWallet(): ActiveWallet {
  return { status: "none", slot: null, name: null, addressHex: null, address: null };
}
