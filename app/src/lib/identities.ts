import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { CHAIN_ID, isLocal } from "./config";

/** Who signs a transaction: a key held in this browser, or the user's own browser wallet. */
export type Signer = { kind: "key"; address: Address; privateKey: Hex } | { kind: "injected"; address: Address };

/** A console operator (org multisig or shift lead). */
export type Operator = { id: string; label: string; signer: Signer };

/** A staff phone or AI agent: a burner key that never leaves this browser. */
export type Device = { id: string; name: string; kind: "staff" | "agent"; signer: Extract<Signer, { kind: "key" }> };

// Anvil's PUBLIC development keys (well-known test mnemonic). Only ever used on the local chain.
const DEV = {
  org: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  lead: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agent: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
} as const satisfies Record<string, Hex>;

const keySigner = (privateKey: Hex): Extract<Signer, { kind: "key" }> => ({
  kind: "key",
  privateKey,
  address: privateKeyToAccount(privateKey).address,
});

export const LOCAL_OPERATORS: Operator[] = isLocal
  ? [
      { id: "org", label: "Org admin", signer: keySigner(DEV.org) },
      { id: "lead", label: "Shift lead", signer: keySigner(DEV.lead) },
    ]
  : [];

export const CUSTOMER_ADDRESS: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const ATTACKER_ADDRESS: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

const STORAGE_KEY = `onshift.devices.${CHAIN_ID}.v2`;
type Stored = { id: string; name: string; kind: "staff" | "agent"; privateKey: Hex };

function read(): Stored[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored[]) : [];
  } catch {
    return [];
  }
}

function write(list: Stored[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode: devices last for this session only */
  }
}

export function loadDevices(): Device[] {
  const stored = read().map((d) => ({ id: d.id, name: d.name, kind: d.kind, signer: keySigner(d.privateKey) }));
  // On the local chain the demo agent wallet (also used by `npm run agent`) is always available.
  if (isLocal) stored.unshift({ id: "agent", name: "Refund bot", kind: "agent", signer: keySigner(DEV.agent) });
  return stored;
}

export function createDevice(name: string, kind: "staff" | "agent"): Device {
  const privateKey = generatePrivateKey();
  const d: Stored = { id: `${kind}-${Date.now().toString(36)}`, name, kind, privateKey };
  write([...read(), d]);
  return { id: d.id, name, kind, signer: keySigner(privateKey) };
}

export function renameDevice(id: string, name: string) {
  write(read().map((d) => (d.id === id ? { ...d, name } : d)));
}

export function removeDevice(id: string) {
  write(read().filter((d) => d.id !== id));
}
