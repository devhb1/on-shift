import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/**
 * Local demo identities. These are Anvil's PUBLIC development keys (from the well-known test
 * mnemonic) and only ever touch the local chain. Staff devices get fresh burner keys generated in
 * this browser - exactly what a staff phone would do.
 */
export type Identity = {
  id: string;
  kind: "org" | "lead" | "agent" | "staff";
  label: string;
  subtitle: string;
  privateKey: Hex;
  address: Address;
};

const DEV_KEYS: Record<"org" | "lead" | "agent", Hex> = {
  org: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  lead: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agent: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
};

export const CUSTOMER_ADDRESS: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
export const ATTACKER_ADDRESS: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

function fixed(kind: "org" | "lead" | "agent", label: string, subtitle: string): Identity {
  const privateKey = DEV_KEYS[kind];
  return { id: kind, kind, label, subtitle, privateKey, address: privateKeyToAccount(privateKey).address };
}

export const FIXED_IDENTITIES: Identity[] = [
  fixed("org", "Org admin", "acme.eth multisig"),
  fixed("lead", "Shift lead", "Issues and revokes passes"),
  fixed("agent", "AI agent", "Refund bot wallet"),
];

const STORAGE_KEY = "onshift.devices.v1";

type StoredDevice = { id: string; name: string; privateKey: Hex };

function readDevices(): StoredDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredDevice[]) : [];
  } catch {
    return [];
  }
}

function writeDevices(devices: StoredDevice[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  } catch {
    /* private mode: devices live for this session only */
  }
}

export function loadStaffDevices(): Identity[] {
  return readDevices().map((d) => ({
    id: d.id,
    kind: "staff",
    label: d.name,
    subtitle: "Staff device (burner key)",
    privateKey: d.privateKey,
    address: privateKeyToAccount(d.privateKey).address,
  }));
}

export function createStaffDevice(name: string): Identity {
  const privateKey = generatePrivateKey();
  const device: StoredDevice = { id: `staff-${Date.now().toString(36)}`, name, privateKey };
  writeDevices([...readDevices(), device]);
  return {
    id: device.id,
    kind: "staff",
    label: name,
    subtitle: "Staff device (burner key)",
    privateKey,
    address: privateKeyToAccount(privateKey).address,
  };
}

export function removeStaffDevice(id: string) {
  writeDevices(readDevices().filter((d) => d.id !== id));
}
