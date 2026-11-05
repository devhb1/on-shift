import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import { publicClient, walletFor } from "./clients";
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
export async function send(privateKey: Hex, call: Call): Promise<TransactionReceipt> {
  const wallet = walletFor(privateKey);
  const abi = [...call.abi, ...ALL_ERRORS] as Abi;
  const { request } = await publicClient.simulateContract({
    account: wallet.account,
    address: call.address,
    abi,
    functionName: call.functionName,
    args: call.args ?? [],
    value: call.value,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted on chain");
  return receipt;
}

/** Simulate only: used for the "try something forbidden" buttons, which need no gas. */
export async function simulate(privateKey: Hex, call: Call): Promise<void> {
  const wallet = walletFor(privateKey);
  await publicClient.simulateContract({
    account: wallet.account,
    address: call.address,
    abi: [...call.abi, ...ALL_ERRORS] as Abi,
    functionName: call.functionName,
    args: call.args ?? [],
    value: call.value,
  });
}
