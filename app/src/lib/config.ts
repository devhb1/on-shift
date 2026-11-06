import { defineChain, type Address, type Hex } from "viem";
import { foundry, sepolia } from "viem/chains";
import deployments from "../generated/deployments.json";

export type Deployment = {
  network: "local" | "sepolia" | string;
  explorer: string;
  chainId: number;
  startBlock: number;
  orgName: string;
  orgNode: Hex;
  opsNode: Hex;
  org: Address;
  lead: Address;
  agent: Address;
  treasury: Address;
  usdc: Address;
  factory: Address;
  registryImpl: Address;
  resolverImpl: Address;
  parentRegistry: Address;
  parentResolver: Address;
  opsRegistry: Address;
  emptyRegistry: Address;
  passIssuer: Address;
  shiftGate: Address;
  incidentSwitch: Address;
};

const all = deployments as Record<string, Deployment>;
export const availableNetworks = Object.values(all).sort((a, b) => (a.network === "sepolia" ? -1 : b.network === "sepolia" ? 1 : 0));

const NETWORK_KEY = "onshift.network.v1";

function pickChainId(): number {
  const forced = import.meta.env.VITE_CHAIN_ID;
  if (forced) return Number(forced);
  try {
    const saved = localStorage.getItem(NETWORK_KEY);
    if (saved && all[saved]) return Number(saved);
  } catch {
    /* ignore */
  }
  // Running locally: prefer the local chain when it is deployed; otherwise the public testnet.
  if (all["31337"] && ["localhost", "127.0.0.1"].includes(window.location.hostname)) return 31337;
  return availableNetworks[0]?.chainId ?? 31337;
}

export const CHAIN_ID = pickChainId();
export const deployment: Deployment | undefined = all[String(CHAIN_ID)];
export const isLocal = CHAIN_ID === foundry.id;

export function switchNetwork(chainId: number) {
  try {
    localStorage.setItem(NETWORK_KEY, String(chainId));
  } catch {
    /* ignore */
  }
  window.location.hash = "#/overview";
  window.location.reload();
}

export const RPC_URLS: string[] = import.meta.env.VITE_RPC_URL
  ? [import.meta.env.VITE_RPC_URL]
  : isLocal
    ? ["http://127.0.0.1:8545"]
    : ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.ethpandaops.io"];

export const chain = isLocal
  ? foundry
  : CHAIN_ID === sepolia.id
    ? sepolia
    : defineChain({
        id: CHAIN_ID,
        name: `Chain ${CHAIN_ID}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: RPC_URLS } },
      });

export const networkLabel = isLocal ? "Local" : CHAIN_ID === sepolia.id ? "Sepolia" : `Chain ${CHAIN_ID}`;
export const POLL_MS = isLocal ? 2000 : 8000;

export const explorerTx = (hash: string) => (deployment?.explorer ? `${deployment.explorer}/tx/${hash}` : "");
export const explorerAddress = (a: string) => (deployment?.explorer ? `${deployment.explorer}/address/${a}` : "");
export const ensAppUrl = (name: string) => (CHAIN_ID === sepolia.id ? `https://sepolia.app.ens.domains/${name}` : "");

/** Organisations this verifier trusts. Anything else is flagged, and look-alikes are called out. */
export const VERIFIED_ORGS = deployment ? [deployment.orgName] : [];

export const USDC_DECIMALS = 6;
export const GAS_DRIP_WEI = isLocal ? 10_000_000_000_000_000n : 3_000_000_000_000_000n; // 0.01 local, 0.003 Sepolia

export const ACTION_REFUND = 1;
export const ACTION_CHECK_IN = 2;
