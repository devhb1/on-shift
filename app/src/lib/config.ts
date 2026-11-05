import { defineChain, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";
import deployments from "../generated/deployments.json";

export type Deployment = {
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
  resolverImpl: Address;
  factory: Address;
  parentRegistry: Address;
  parentResolver: Address;
  opsRegistry: Address;
  emptyRegistry: Address;
  passIssuer: Address;
  shiftGate: Address;
  incidentSwitch: Address;
};

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 31337);

export const chain =
  CHAIN_ID === foundry.id
    ? foundry
    : defineChain({
        id: CHAIN_ID,
        name: `Chain ${CHAIN_ID}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      });

export const deployment: Deployment | undefined = (deployments as Record<string, Deployment>)[String(CHAIN_ID)];

/** Organisations this verifier trusts. Anything else is flagged, and look-alikes are called out. */
export const VERIFIED_ORGS = deployment ? [deployment.orgName] : [];

export const USDC_DECIMALS = 6;
export const GAS_DRIP_WEI = 10_000_000_000_000_000n; // 0.01 ETH so staff never need a faucet

export const ACTION_REFUND = 1;
export const ACTION_CHECK_IN = 2;
