import { getAddress, namehash, type Address, type Hex } from "viem";
import { permissionedResolverAbi } from "../generated/abis";
import { publicClient } from "./clients";
import { deployment } from "./config";

const ETH_COIN_TYPE = 60n;

/** What `till.<org>` currently tells a client that does not trust the cached gate address. */
export type TillView = {
  gate: Address;
  cached: Address;
  /** Resolved address exists and is not the address in deployments.json. */
  stale: boolean;
  quarantined: boolean;
  /** The till name has an ETH address record. Older Sepolia deploys do not. */
  published: boolean;
  status: string;
};

function addressFromAddr(raw: Hex): Address | undefined {
  const body = raw.toLowerCase().replace(/^0x/, "");
  if (body.length < 40 || /^0+$/.test(body)) return undefined;
  return getAddress(`0x${body.slice(-40)}`);
}

export async function resolveTill(): Promise<TillView> {
  const d = deployment!;
  const node = namehash(`till.${d.orgName}`);
  const [status, raw] = await Promise.all([
    publicClient.readContract({
      address: d.parentResolver,
      abi: permissionedResolverAbi,
      functionName: "text",
      args: [node, "till.status"],
    }),
    publicClient.readContract({
      address: d.parentResolver,
      abi: permissionedResolverAbi,
      functionName: "addr",
      args: [node, ETH_COIN_TYPE],
    }),
  ]);
  const published = addressFromAddr(raw);
  return {
    gate: published ?? d.shiftGate,
    cached: d.shiftGate,
    stale: Boolean(published && published.toLowerCase() !== d.shiftGate.toLowerCase()),
    quarantined: status === "quarantine",
    published: Boolean(published),
    status,
  };
}
