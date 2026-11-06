// Reproduce ShiftGate's allow/deny for a pass name. No keys. Callers (bots, other agents)
// should refuse to talk to an operator when this says not live — including a quarantined till.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, namehash, toBytes } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDeployment(chainId = "11155111") {
  return JSON.parse(readFileSync(join(root, "contracts/deployments", `${chainId}.json`), "utf8"));
}

/** Optional forge build output. Prefer the embedded reads below so the package works without Foundry. */
export function abi(name) {
  const file = join(root, "contracts", "out", `${name}.sol`, `${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run forge build, or use checkPass which embeds the reads it needs.`);
  return JSON.parse(readFileSync(file, "utf8")).abi;
}

export function labelId(label) {
  return BigInt(keccak256(toBytes(label)));
}

const REGISTRY_READS = [
  {
    type: "function",
    name: "getSubregistry",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getState",
    stateMutability: "view",
    inputs: [{ name: "anyId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "expiry", type: "uint64" },
          { name: "tokenId", type: "uint256" },
          { name: "resource", type: "uint256" },
          { name: "latestOwner", type: "address" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
];

const GATE_READS = [
  {
    type: "function",
    name: "passStatus",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "live", type: "bool" },
          { name: "latestOwner", type: "address" },
          { name: "resolver", type: "address" },
          { name: "expiry", type: "uint64" },
          { name: "cap", type: "uint256" },
          { name: "spent", type: "uint256" },
          { name: "actions", type: "uint8" },
          { name: "shiftStatus", type: "string" },
        ],
      },
    ],
  },
];

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
 * Same questions ShiftGate asks, plus till quarantine. Does not move money.
 * `live` is false when the pass is dead or the till is quarantined.
 */
export async function checkPass(publicClient, d, label) {
  const till = await resolveTill(publicClient, d).catch(() => ({
    gate: d.shiftGate,
    quarantined: false,
    status: "",
    published: false,
    stale: false,
  }));
  const ops = await publicClient.readContract({
    address: d.parentRegistry,
    abi: REGISTRY_READS,
    functionName: "getSubregistry",
    args: ["ops"],
  });
  const [state, status] = await Promise.all([
    publicClient.readContract({ address: ops, abi: REGISTRY_READS, functionName: "getState", args: [labelId(label)] }),
    publicClient.readContract({ address: till.gate, abi: GATE_READS, functionName: "passStatus", args: [label] }),
  ]);
  let agentContext = "";
  if (status.resolver && status.resolver !== "0x0000000000000000000000000000000000000000") {
    try {
      agentContext = await publicClient.readContract({
        address: status.resolver,
        abi: RESOLVER_READS,
        functionName: "text",
        args: [namehash(`${label}.ops.${d.orgName}`), "agent-context"],
      });
    } catch {
      agentContext = "";
    }
  }
  const passLive = Boolean(status.live);
  return {
    name: `${label}.ops.${d.orgName}`,
    live: passLive && !till.quarantined,
    passLive,
    tillQuarantined: Boolean(till.quarantined),
    tillStatus: till.status,
    gate: till.gate,
    registryStatus: Number(state.status),
    expiry: Number(status.expiry),
    holder: status.latestOwner,
    cap: status.cap,
    spent: status.spent,
    roleNote: status.shiftStatus,
    agentContext,
  };
}
