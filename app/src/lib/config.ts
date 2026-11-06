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
  demoNode?: Hex;
  sandboxTillNode?: Hex;
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
  demoRegistry?: Address;
  emptyRegistry: Address;
  passIssuer: Address;
  shiftGate: Address;
  /** Separate till for Playground demo passes. */
  sandboxGate?: Address;
  incidentSwitch: Address;
  /** Public faucet for demo.<org> passes only. */
  playground?: Address;
  /** First block of the current ShiftGate, when it was replaced after the first deployment. */
  gateStartBlock?: number;
  legacyShiftGate?: Address;
};

const all = deployments as Record<string, Deployment>;
/** The Anvil chain is a developer harness. The product only follows it when VITE_CHAIN_ID forces it. */
const allowLocal = import.meta.env.VITE_CHAIN_ID === "31337";
export const availableNetworks = Object.values(all)
  .filter((n) => allowLocal || n.network !== "local")
  .sort((a, b) => (a.network === "sepolia" ? -1 : b.network === "sepolia" ? 1 : 0));

const NETWORK_KEY = "onshift.network.v2";

function pickChainId(): number {
  const forced = import.meta.env.VITE_CHAIN_ID;
  if (forced && all[String(Number(forced))]) return Number(forced);
  try {
    const saved = localStorage.getItem(NETWORK_KEY);
    const savedDeployment = saved ? all[saved] : undefined;
    if (savedDeployment && savedDeployment.network !== "local") return savedDeployment.chainId;
  } catch {
    /* ignore */
  }
  return availableNetworks.find((n) => n.network !== "local")?.chainId ?? availableNetworks[0]?.chainId ?? sepolia.id;
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

const PUBLIC_SEPOLIA = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.org",
  "https://rpc.sepolia.ethpandaops.io",
  "https://1rpc.io/sepolia",
];

/** A configured RPC is tried first. Public endpoints stay behind it so one rate limit doesn't blank the app. */
export const RPC_URLS: string[] = isLocal
  ? [import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545"]
  : import.meta.env.VITE_RPC_URL
    ? [import.meta.env.VITE_RPC_URL, ...PUBLIC_SEPOLIA.filter((url) => url !== import.meta.env.VITE_RPC_URL)]
    : PUBLIC_SEPOLIA;

/** Anvil deploys this Multicall3 address. viem's Foundry chain does not list it, so batched reads were rejected. */
const LOCAL_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const chain = isLocal
  ? defineChain({
      ...foundry,
      contracts: {
        ...foundry.contracts,
        multicall3: { address: LOCAL_MULTICALL3 },
      },
    })
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

/** ENS UniversalResolverV2 on Sepolia: the same entry point wallets and explorers use. */
export const UNIVERSAL_RESOLVER: Address | undefined = CHAIN_ID === sepolia.id ? "0x85eDf8B6b7D4211e2b07AA687506B746357B92cf" : undefined;

/** Organisations this verifier trusts. Anything else is flagged, and look-alikes are called out.
 *  Multi-tenant shops enrol through ShopFactory; until that address is in deployments.json this is the platform name. */
export const VERIFIED_ORGS = deployment ? [deployment.orgName] : [];

export const USDC_DECIMALS = 6;
export const GAS_DRIP_WEI = isLocal ? 10_000_000_000_000_000n : 3_000_000_000_000_000n; // 0.01 local, 0.003 Sepolia

export const ACTION_REFUND = 1;
export const ACTION_CHECK_IN = 2;
