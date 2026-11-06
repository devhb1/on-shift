// Reproduce ShiftGate's allow/deny for a pass name. No keys. Callers (bots, other agents)
// should refuse to talk to an operator when this says not live.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, namehash, toBytes } from "viem";

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

const RESOLVER_READS = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
  },
];

function addressFromAddr(raw) {
  if (!raw || raw === "0x") return undefined;
  const body = String(raw).toLowerCase().replace(/^0x/, "");
  if (body.length < 40 || /^0+$/.test(body)) return undefined;
  return getAddress(`0x${body.slice(-40)}`);
}

/** The gate a stranger should call, read from till.<org> rather than a cached address. */
export async function resolveTill(publicClient, d) {
  const node = namehash(`till.${d.orgName}`);
  const [status, raw] = await Promise.all([
    publicClient.readContract({ address: d.parentResolver, abi: RESOLVER_READS, functionName: "text", args: [node, "till.status"] }),
    publicClient.readContract({ address: d.parentResolver, abi: RESOLVER_READS, functionName: "addr", args: [node, 60n] }),
  ]);
  const published = addressFromAddr(raw);
  return {
    gate: published ?? d.shiftGate,
    status,
    quarantined: status === "quarantine",
    published: Boolean(published),
    stale: Boolean(published && published.toLowerCase() !== String(d.shiftGate).toLowerCase()),
  };
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
