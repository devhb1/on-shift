import type { Abi, Address, TransactionReceipt } from "viem";
import { injectedWallet, publicClient, walletFor } from "./clients";
import type { Signer } from "./identities";
import {
  incidentSwitchAbi,
  mockUSDCAbi,
  passIssuerAbi,
  permissionedRegistryAbi,
  permissionedResolverAbi,
  shiftGateAbi,
} from "../generated/abis";

/** Every custom error in the system, so a revert bubbling up from a nested call still decodes. */
const ALL_ERRORS = [
  ...passIssuerAbi,
  ...shiftGateAbi,
  ...incidentSwitchAbi,
  ...permissionedRegistryAbi,
  ...permissionedResolverAbi,
  ...mockUSDCAbi,
].filter((item) => item.type === "error");

export type Call = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

/** Simulate first (so designed reverts surface with their real error name), then send and wait. */
export async function send(signer: Signer, call: Call): Promise<TransactionReceipt> {
  const abi = [...call.abi, ...ALL_ERRORS] as Abi;
  const base = { address: call.address, abi, functionName: call.functionName, args: call.args ?? [], value: call.value };
  let hash: `0x${string}`;
  if (signer.kind === "key") {
    const wallet = walletFor(signer.privateKey);
    const { request } = await publicClient.simulateContract({ ...base, account: wallet.account });
    hash = await wallet.writeContract(request);
  } else {
    const { wallet, address } = await injectedWallet();
    await publicClient.simulateContract({ ...base, account: address });
    hash = await wallet.writeContract({ ...base, account: address, chain: wallet.chain });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted on chain");
  return receipt;
}

/** Simulate only: used for "try something forbidden", which needs no gas and changes nothing. */
export async function simulate(signer: Signer, call: Call): Promise<void> {
  await publicClient.simulateContract({
    account: signer.address,
    address: call.address,
    abi: [...call.abi, ...ALL_ERRORS] as Abi,
    functionName: call.functionName,
    args: call.args ?? [],
    value: call.value,
  });
}
