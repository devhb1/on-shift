import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, RPC_URL } from "./config";

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval: 500 });

export function walletFor(privateKey: Hex) {
  return createWalletClient({ account: privateKeyToAccount(privateKey), chain, transport: http(RPC_URL) });
}
