import { createPublicClient, createWalletClient, custom, fallback, http, type Address, type EIP1193Provider, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, POLL_MS, RPC_URLS } from "./config";

export const publicClient = createPublicClient({
  chain,
  transport: fallback(RPC_URLS.map((u) => http(u))),
  pollingInterval: Math.min(POLL_MS, 2000),
});

export function walletFor(privateKey: Hex) {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: fallback(RPC_URLS.map((u) => http(u))) });
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export const hasInjectedWallet = () => typeof window !== "undefined" && !!window.ethereum;

type WalletEvents = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export function walletEvents(): WalletEvents | undefined {
  return window.ethereum as WalletEvents | undefined;
}

/** Accounts already approved for this site. Does not open the wallet. */
export async function silentAddress(): Promise<Address | undefined> {
  if (!window.ethereum) return;
  const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
  return accounts[0] as Address | undefined;
}

/** A browser wallet (MetaMask, Rabby, …) switched to the right chain. */
export async function injectedWallet(opts?: { prompt?: boolean }) {
  if (!window.ethereum) throw new Error("No browser wallet found");
  if (opts?.prompt) {
    await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  }
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [address] = await wallet.requestAddresses();
  if ((await wallet.getChainId()) !== chain.id) {
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain });
    }
  }
  return { wallet, address };
}
