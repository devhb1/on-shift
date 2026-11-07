import { AlertOctagon, Bot, CircleDollarSign, CreditCard, DoorOpen, Headset, Plus, RotateCcw, ScanLine, ShoppingBag, Ticket, UserPlus, XOctagon, type LucideIcon } from "lucide-react";
import type { ActivityItem, PassRow, Preset, Snapshot } from "../lib/onshift";
import type { Tint } from "../components/ui";
import { LOCAL_OPERATORS, type Device } from "../lib/identities";
import { sameAddress, short } from "../lib/format";

/** One icon + colour per role, used everywhere a pass appears. */
export function roleLook(preset?: Preset): { icon: LucideIcon; tint: Tint } {
  switch (preset?.name) {
    case "Cashier":
      return { icon: ShoppingBag, tint: "blue" };
    case "Support":
      return { icon: Headset, tint: "purple" };
    case "AI agent":
      return { icon: Bot, tint: "graphite" };
    case "Door staff":
      return { icon: DoorOpen, tint: "teal" };
    case "Demo cashier":
      return { icon: ShoppingBag, tint: "blue" };
    case "Demo agent":
      return { icon: Bot, tint: "graphite" };
    default:
      return { icon: ScanLine, tint: "indigo" };
  }
}

export const ACTIVITY_LOOK: Record<ActivityItem["kind"], { icon: LucideIcon; tint: Tint }> = {
  issued: { icon: Plus, tint: "blue" },
  revoked: { icon: XOctagon, tint: "red" },
  paid: { icon: CreditCard, tint: "green" },
  refund: { icon: CircleDollarSign, tint: "orange" },
  checkin: { icon: Ticket, tint: "green" },
  incident: { icon: AlertOctagon, tint: "red" },
  restored: { icon: RotateCcw, tint: "green" },
  lead: { icon: UserPlus, tint: "soft" },
};

/** Human name for a wallet: a device on this computer, the org, a lead — or a short address. */
export function whoIs(address: string, s: Snapshot, devices: Device[], org?: string) {
  const d = devices.find((x) => sameAddress(x.signer.address, address));
  if (d) return d.name;
  if (org && sameAddress(org, address)) return "Org admin";
  const op = LOCAL_OPERATORS.find((o) => sameAddress(o.signer.address, address));
  if (op) return op.label;
  if (s.leads.some((l) => sameAddress(l.address, address))) return `Lead ${short(address)}`;
  return short(address);
}

export const passPreset = (s: Snapshot, p: PassRow) => (p.sandbox ? s.demoPresets : s.presets)[p.presetId];
