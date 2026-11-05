import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeAbiParameters, keccak256, toBytes, type Address } from "viem";
import { publicClient } from "./clients";
import { deployment } from "./config";
import { sameAddress, usdc } from "./format";
import { incidentSwitchAbi, passIssuerAbi, permissionedRegistryAbi, shiftGateAbi, mockUSDCAbi } from "../generated/abis";

export type Preset = {
  id: number;
  name: string;
  maxCap: bigint;
  maxDuration: number;
  actions: number;
  agent: boolean;
  active: boolean;
};

export type PassState = "live" | "expired" | "revoked" | "killed";

export type PassRow = {
  index: number;
  label: string;
  name: string;
  holder: Address;
  issuer: Address;
  resolver: Address;
  registry: Address;
  issuedAt: number;
  expiry: number;
  presetId: number;
  cap: bigint;
  spent: bigint;
  state: PassState;
  shiftStatus: string;
  isLatestForLabel: boolean;
};

export type ActivityItem = {
  key: string;
  ts: number;
  blockNumber: bigint;
  kind: "issued" | "revoked" | "refund" | "checkin" | "incident" | "restored" | "lead";
  title: string;
  detail: string;
};

export type Lead = { address: Address; dailyBudget: number; active: boolean; remaining: number };

export type Snapshot = {
  blockTs: number;
  currentOps: Address;
  incident: boolean;
  incidentReason: string;
  epoch: number;
  gateFloat: bigint;
  presets: Preset[];
  passes: PassRow[];
  activity: ActivityItem[];
  leads: Lead[];
};

type Ctx = {
  snapshot?: Snapshot;
  error?: string;
  /** chain time minus wall-clock time, so countdowns follow block.timestamp, not the laptop clock */
  chainOffset: number;
  refresh: () => Promise<void>;
};

const OnShiftContext = createContext<Ctx>({ chainOffset: 0, refresh: async () => {} });

export const labelId = (label: string) => BigInt(keccak256(toBytes(label)));

type RawPass = {
  label: string;
  holder: Address;
  issuer: Address;
  resolver: Address;
  registry: Address;
  issuedAt: bigint;
  expiry: bigint;
  presetId: number;
  cap: bigint;
};

async function loadSnapshot(passCache: Map<number, RawPass>, blockTimes: Map<bigint, number>): Promise<Snapshot> {
  const d = deployment!;
  const fromBlock = BigInt(d.startBlock);

  const [block, currentOps, incident, incidentReason, epoch, gateFloat, passCount, presetCount] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({ address: d.parentRegistry, abi: permissionedRegistryAbi, functionName: "getSubregistry", args: ["ops"] }),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "incident" }),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "reason" }),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "epoch" }),
    publicClient.readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [d.shiftGate] }),
    publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "passCount" }),
    publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "presetCount" }),
  ]);
  const blockTs = Number(block.timestamp);

  const presets: Preset[] = await Promise.all(
    Array.from({ length: Number(presetCount) }, async (_, id) => {
      const p = await publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "getPreset", args: [id] });
      return { id, name: p.name, maxCap: p.maxCap, maxDuration: Number(p.maxDuration), actions: p.actions, agent: p.agent, active: p.active };
    }),
  );

  // Pass records are immutable once issued: fetch each index once (reset if the chain was restarted).
  if (passCache.size > Number(passCount)) passCache.clear();
  await Promise.all(
    Array.from({ length: Number(passCount) }, async (_, i) => {
      if (passCache.has(i)) return;
      const p = await publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "getPass", args: [BigInt(i)] });
      passCache.set(i, p as RawPass);
    }),
  );

  const [issuerLogs, gateLogs, switchLogs] = await Promise.all([
    publicClient.getContractEvents({ address: d.passIssuer, abi: passIssuerAbi, fromBlock }),
    publicClient.getContractEvents({ address: d.shiftGate, abi: shiftGateAbi, fromBlock }),
    publicClient.getContractEvents({ address: d.incidentSwitch, abi: incidentSwitchAbi, fromBlock }),
  ]);
  const revoked = new Set<number>();
  for (const log of issuerLogs) if (log.eventName === "PassRevoked") revoked.add(Number(log.args.index));

  const raws = [...passCache.entries()].sort((a, b) => a[0] - b[0]);
  const latestByLabel = new Map<string, number>();
  for (const [i, p] of raws) latestByLabel.set(p.label, i);

  const passes: PassRow[] = await Promise.all(
    raws.map(async ([index, p]) => {
      const isLatestForLabel = latestByLabel.get(p.label) === index;
      const shiftKey = keccak256(
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint64" }], [p.registry, labelId(p.label), p.expiry]),
      );
      const spent = await publicClient.readContract({ address: d.shiftGate, abi: shiftGateAbi, functionName: "spent", args: [shiftKey] });

      let state: PassState;
      let shiftStatus = "";
      const expired = blockTs >= Number(p.expiry);
      if (revoked.has(index)) state = "revoked";
      else if (!isLatestForLabel || expired) state = "expired";
      else if (!sameAddress(p.registry, currentOps)) state = "killed";
      else {
        const st = await publicClient.readContract({ address: d.shiftGate, abi: shiftGateAbi, functionName: "passStatus", args: [p.label] });
        state = st.live ? "live" : "revoked";
        shiftStatus = st.shiftStatus;
      }
      return {
        index,
        label: p.label,
        name: `${p.label}.ops.${d.orgName}`,
        holder: p.holder,
        issuer: p.issuer,
        resolver: p.resolver,
        registry: p.registry,
        issuedAt: Number(p.issuedAt),
        expiry: Number(p.expiry),
        presetId: p.presetId,
        cap: p.cap,
        spent,
        state,
        shiftStatus,
        isLatestForLabel,
      };
    }),
  );

  // Leads from events, then their remaining budget for today.
  const leadMap = new Map<string, { address: Address; dailyBudget: number; active: boolean }>();
  for (const log of issuerLogs) {
    if (log.eventName === "LeadUpdated") {
      leadMap.set(log.args.lead!.toLowerCase(), { address: log.args.lead!, dailyBudget: Number(log.args.dailyBudget), active: !!log.args.active });
    }
  }
  const leads: Lead[] = await Promise.all(
    [...leadMap.values()].map(async (l) => ({
      ...l,
      remaining: Number(await publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "remainingBudget", args: [l.address] })),
    })),
  );

  // Activity feed with block timestamps.
  const all = [...issuerLogs, ...gateLogs, ...switchLogs];
  const missing = [...new Set(all.map((l) => l.blockNumber))].filter((n) => !blockTimes.has(n));
  await Promise.all(
    missing.map(async (n) => blockTimes.set(n, Number((await publicClient.getBlock({ blockNumber: n })).timestamp))),
  );
  const presetName = (id: number) => presets[id]?.name ?? "Pass";
  const activity: ActivityItem[] = [];
  for (const log of all) {
    const base = { key: `${log.transactionHash}-${log.logIndex}`, ts: blockTimes.get(log.blockNumber) ?? 0, blockNumber: log.blockNumber };
    switch (log.eventName) {
      case "PassIssued":
        activity.push({ ...base, kind: "issued", title: `${presetName(log.args.presetId!)} pass issued`, detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "PassRevoked":
        activity.push({ ...base, kind: "revoked", title: "Pass revoked early", detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "Refunded":
        activity.push({ ...base, kind: "refund", title: `Refund of ${usdc(log.args.amount!)} paid`, detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "CheckedIn":
        activity.push({ ...base, kind: "checkin", title: "Ticket checked in", detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "BreakGlass":
        activity.push({ ...base, kind: "incident", title: "Break-glass: all passes stopped", detail: log.args.reason || "No reason given" });
        break;
      case "Restored":
        activity.push({ ...base, kind: "restored", title: "Namespace restored (fresh registry)", detail: `Epoch ${log.args.epoch}` });
        break;
      case "LeadUpdated":
        activity.push({ ...base, kind: "lead", title: log.args.active ? "Shift lead enabled" : "Shift lead disabled", detail: `Daily budget ${log.args.dailyBudget}` });
        break;
    }
  }
  activity.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? 1 : -1));

  return {
    blockTs,
    currentOps: currentOps as Address,
    incident,
    incidentReason,
    epoch: Number(epoch),
    gateFloat,
    presets,
    passes: passes.reverse(),
    activity,
    leads,
  };
}

export function OnShiftProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [chainOffset, setChainOffset] = useState(0);
  const passCache = useRef(new Map<number, RawPass>());
  const blockTimes = useRef(new Map<bigint, number>());
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!deployment) {
      setError("no-deployment");
      return;
    }
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const s = await loadSnapshot(passCache.current, blockTimes.current);
        setSnapshot(s);
        setChainOffset(s.blockTs - Date.now() / 1000);
        setError(undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight.current = null;
      }
    })();
    return inFlight.current;
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(() => ({ snapshot, error, chainOffset, refresh }), [snapshot, error, chainOffset, refresh]);
  return <OnShiftContext.Provider value={value}>{children}</OnShiftContext.Provider>;
}

export const useOnShift = () => useContext(OnShiftContext);

/** Chain-aligned "now" in seconds, ticking twice a second. */
export function useChainNow() {
  const { chainOffset } = useOnShift();
  const [now, setNow] = useState(() => Date.now() / 1000 + chainOffset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000 + chainOffset), 500);
    setNow(Date.now() / 1000 + chainOffset);
    return () => clearInterval(t);
  }, [chainOffset]);
  return now;
}
