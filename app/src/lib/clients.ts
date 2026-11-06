import { createPublicClient, createWalletClient, custom, fallback, http, type EIP1193Provider, type Hex } from "viem";
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

/** A browser wallet (MetaMask, Rabby, …) switched to the right chain. */
export async function injectedWallet() {
  if (!window.ethereum) throw new Error("No browser wallet found");
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
