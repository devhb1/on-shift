// Reproduce ShiftGate's allow/deny for a pass name. No keys. Callers (bots, other agents)
// should refuse to talk to an operator when this says not live.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toBytes } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDeployment(chainId = "11155111") {
  return JSON.parse(readFileSync(join(root, "contracts/deployments", `${chainId}.json`), "utf8"));
}

export function abi(name) {
  return JSON.parse(readFileSync(join(root, "contracts/out", `${name}.sol`, `${name}.json`), "utf8")).abi;
}

export function labelId(label) {
  return BigInt(keccak256(toBytes(label)));
}

/**
 * Same questions ShiftGate asks: is ops live, is the label REGISTERED and unexpired,
 * who is latestOwner, what is the cap. Does not move money.
 */
export async function checkPass(publicClient, d, label) {
  const registryAbi = abi("PermissionedRegistry");
  const gateAbi = abi("ShiftGate");
  const ops = await publicClient.readContract({
    address: d.parentRegistry,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: ["ops"],
  });
  const [state, status] = await Promise.all([
    publicClient.readContract({ address: ops, abi: registryAbi, functionName: "getState", args: [labelId(label)] }),
    publicClient.readContract({ address: d.shiftGate, abi: gateAbi, functionName: "passStatus", args: [label] }),
  ]);
  return {
    name: `${label}.ops.${d.orgName}`,
    live: Boolean(status.live),
    registryStatus: Number(state.status),
    expiry: Number(status.expiry),
    holder: status.latestOwner,
    cap: status.cap,
    spent: status.spent,
    roleNote: status.shiftStatus,
  };
}
