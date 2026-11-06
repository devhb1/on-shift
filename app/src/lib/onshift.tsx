import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeAbiParameters, keccak256, namehash, toBytes, type Address } from "viem";
import { publicClient } from "./clients";
import { deployment, POLL_MS } from "./config";
import { sameAddress, usdc } from "./format";
import { incidentSwitchAbi, passIssuerAbi, permissionedRegistryAbi, playgroundAbi, shiftGateAbi, mockUSDCAbi } from "../generated/abis";

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
  /** The wallet that asked the Playground for this pass, if it came from there. */
  requester?: Address;
};

export type Order = {
  orderId: `0x${string}`;
  payer: Address;
  paid: bigint;
  refunded: bigint;
  blockNumber: bigint;
  ts: number;
  txHash: string;
};

export type ActivityItem = {
  key: string;
  ts: number;
  blockNumber: bigint;
  txHash: string;
  label?: string;
  kind: "issued" | "revoked" | "paid" | "refund" | "checkin" | "incident" | "restored" | "lead";
  title: string;
  detail: string;
};

export type Lead = { address: Address; dailyBudget: number; active: boolean; remaining: number };

export type Snapshot = {
  blockTs: number;
  currentOps: Address;
  /** Live org from PassIssuer.org(). Falls back to the deployment address on older gates. */
  org: Address;
  incident: boolean;
  incidentReason: string;
  /** False on deployments whose IncidentSwitch predates till aliasing. */
  tillQuarantined: boolean;
  hasTillAlias: boolean;
  epoch: number;
  gateFloat: bigint;
  presets: Preset[];
  passes: PassRow[];
  activity: ActivityItem[];
  leads: Lead[];
  /** Orders paid into the gate, newest first, with what has been refunded so far. */
  orders: Order[];
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

/** ENS node of a pass name, e.g. shift-0412.ops.onshift.eth or play-….demo.onshift.eth. */
export const passNode = (label: string, ns: "ops" | "demo" = "ops") =>
  namehash(`${label}.${ns}.${deployment!.orgName}`);

/** Sandbox Playground names under demo.<org> — never treat as real staff. */
export function isDemoPassName(name: string, orgName = deployment?.orgName ?? "onshift.eth") {
  return name.toLowerCase().endsWith(`.demo.${orgName.toLowerCase()}`);
}

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

type IssuerLog = Awaited<ReturnType<typeof pullIssuer>>[number];
type GateLog = Awaited<ReturnType<typeof pullGate>>[number];
type SwitchLog = Awaited<ReturnType<typeof pullSwitch>>[number];
type PlaygroundLog = Awaited<ReturnType<typeof pullPlayground>>[number];

type EventCache = {
  /** Last block included in the cached logs. -1 before the first successful read. */
  tip: bigint;
  issuer: IssuerLog[];
  gate: GateLog[];
  sw: SwitchLog[];
  pg: PlaygroundLog[];
};

const pullIssuer = (from: bigint, to: bigint) =>
  publicClient.getContractEvents({ address: deployment!.passIssuer, abi: passIssuerAbi, fromBlock: from, toBlock: to });
const pullGate = (from: bigint, to: bigint) =>
  publicClient.getContractEvents({ address: deployment!.shiftGate, abi: shiftGateAbi, fromBlock: from, toBlock: to });
const pullSwitch = (from: bigint, to: bigint) =>
  publicClient.getContractEvents({ address: deployment!.incidentSwitch, abi: incidentSwitchAbi, fromBlock: from, toBlock: to });
const pullPlayground = (from: bigint, to: bigint) =>
  deployment!.playground
    ? publicClient.getContractEvents({ address: deployment!.playground, abi: playgroundAbi, fromBlock: from, toBlock: to })
    : Promise.resolve([]);

function isRangeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /block range|too many|query returned more|exceed|response size|log limit|10[,.]?000/i.test(message);
}

/** One getLogs when the RPC allows it. Public endpoints often cap the span, so fall back to chunks. */
async function collect<T>(fromBlock: bigint, toBlock: bigint, pull: (from: bigint, to: bigint) => Promise<readonly T[]>): Promise<T[]> {
  if (fromBlock > toBlock) return [];
  try {
    return [...(await pull(fromBlock, toBlock))];
  } catch (error) {
    if (!isRangeError(error)) throw error;
    const span = 9_999n;
    const all: T[] = [];
    for (let start = fromBlock; start <= toBlock; start += span) {
      const end = start + span - 1n > toBlock ? toBlock : start + span - 1n;
      all.push(...(await pull(start, end)));
    }
    return all;
  }
}

function mergeLogs<T extends { transactionHash: string; logIndex: number | null }>(prev: T[], next: T[]): T[] {
  if (next.length === 0) return prev;
  const seen = new Set(prev.map((log) => `${log.transactionHash}:${log.logIndex}`));
  const extra = next.filter((log) => !seen.has(`${log.transactionHash}:${log.logIndex}`));
  return extra.length === 0 ? prev : [...prev, ...extra];
}

async function syncLogs(cache: EventCache, toBlock: bigint) {
  const startBlock = BigInt(deployment!.startBlock);
  if (cache.tip > toBlock) {
    cache.tip = -1n;
    cache.issuer = [];
    cache.gate = [];
    cache.sw = [];
    cache.pg = [];
  }
  const from = cache.tip < startBlock ? startBlock : cache.tip > startBlock + 20n ? cache.tip - 20n : startBlock;
  if (from > toBlock) return;
  // The gate and the Playground were deployed after the issuer: don't page through blocks before them.
  const after = (block?: number) => (block && BigInt(block) > from ? BigInt(block) : from);
  const [issuer, gate, sw, pg] = await Promise.all([
    collect(from, toBlock, pullIssuer),
    collect(after(deployment!.gateStartBlock), toBlock, pullGate),
    collect(from, toBlock, pullSwitch),
    collect(after(deployment!.gateStartBlock), toBlock, pullPlayground),
  ]);
  cache.issuer = mergeLogs(cache.issuer, issuer);
  cache.gate = mergeLogs(cache.gate, gate);
  cache.sw = mergeLogs(cache.sw, sw);
  cache.pg = mergeLogs(cache.pg, pg);
  cache.tip = toBlock;
}

type BatchCall = { address: Address; abi: typeof passIssuerAbi | typeof shiftGateAbi; functionName: string; args: readonly unknown[] };

async function readEach<T>(calls: readonly BatchCall[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < calls.length; i += 8) {
    const slice = calls.slice(i, i + 8);
    const part = await Promise.all(slice.map((call) => publicClient.readContract(call as never)));
    out.push(...(part as T[]));
  }
  return out;
}

/** One Multicall3 eth_call when the chain has it. Anvil without that predeploy falls back to single reads. */
async function batched<T>(calls: readonly BatchCall[]): Promise<T[]> {
  if (calls.length === 0) return [];
  try {
    const out: T[] = [];
    for (let i = 0; i < calls.length; i += 40) {
      const part = await publicClient.multicall({ allowFailure: false, contracts: calls.slice(i, i + 40) as never });
      out.push(...(part as T[]));
    }
    return out;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/multicall3/i.test(message)) throw error;
    return readEach<T>(calls);
  }
}

async function loadSnapshot(passCache: Map<number, RawPass>, blockTimes: Map<bigint, number>, events: EventCache): Promise<Snapshot> {
  const d = deployment!;

  const [block, currentOps, liveOrg, incident, incidentReason, epoch, gateFloat, passCount, presetCount, tillQ] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({ address: d.parentRegistry, abi: permissionedRegistryAbi, functionName: "getSubregistry", args: ["ops"] }),
    publicClient
      .readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "org" })
      .then((a) => a as Address)
      .catch(() => d.org),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "incident" }),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "reason" }),
    publicClient.readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "epoch" }),
    publicClient.readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [d.shiftGate] }),
    publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "passCount" }),
    publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "presetCount" }),
    publicClient
      .readContract({ address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "tillQuarantined" })
      .then((v) => ({ ok: true as const, v: Boolean(v) }))
      .catch(() => ({ ok: false as const, v: false })),
  ]);
  const blockTs = Number(block.timestamp);
  const tip = block.number ?? 0n;

  const presetRows = await batched<{ name: string; maxCap: bigint; maxDuration: bigint; actions: number; agent: boolean; active: boolean }>(
    Array.from({ length: Number(presetCount) }, (_, id) => ({
      address: d.passIssuer,
      abi: passIssuerAbi,
      functionName: "getPreset",
      args: [id],
    })),
  );
  const presets: Preset[] = presetRows.map((p, id) => ({
    id,
    name: p.name,
    maxCap: p.maxCap,
    maxDuration: Number(p.maxDuration),
    actions: p.actions,
    agent: p.agent,
    active: p.active,
  }));

  // Pass records are immutable once issued: fetch each index once (reset if the chain was restarted).
  if (passCache.size > Number(passCount)) {
    passCache.clear();
    events.tip = -1n;
    events.issuer = [];
    events.gate = [];
    events.sw = [];
    events.pg = [];
  }
  const missing = Array.from({ length: Number(passCount) }, (_, i) => i).filter((i) => !passCache.has(i));
  const fetched = await batched<RawPass>(
    missing.map((i) => ({ address: d.passIssuer, abi: passIssuerAbi, functionName: "getPass", args: [BigInt(i)] })),
  );
  missing.forEach((i, n) => passCache.set(i, fetched[n]));

  await syncLogs(events, tip);
  const issuerLogs = events.issuer;
  const gateLogs = events.gate;
  const switchLogs = events.sw;
  const requesterByLabel = new Map<string, Address>();
  for (const log of events.pg) if (log.eventName === "Tried") requesterByLabel.set(log.args.label!, log.args.requester!);
  const revoked = new Set<number>();
  for (const log of issuerLogs) if (log.eventName === "PassRevoked") revoked.add(Number(log.args.index));

  const raws = [...passCache.entries()].sort((a, b) => a[0] - b[0]);
  const latestByLabel = new Map<string, number>();
  for (const [i, p] of raws) latestByLabel.set(p.label, i);

  const shiftKeys = raws.map(([, p]) =>
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint64" }], [p.registry, labelId(p.label), p.expiry])),
  );
  const spentValues = await batched<bigint>(
    shiftKeys.map((shiftKey) => ({ address: d.shiftGate, abi: shiftGateAbi, functionName: "spent", args: [shiftKey] })),
  );
  const liveCandidates = raws
    .map(([index, p], i) => ({ index, p, i }))
    .filter(({ index, p }) => {
      const expired = blockTs >= Number(p.expiry);
      return !revoked.has(index) && latestByLabel.get(p.label) === index && !expired && sameAddress(p.registry, currentOps);
    });
  const statuses = await batched<{ live: boolean; shiftStatus: string }>(
    liveCandidates.map(({ p }) => ({ address: d.shiftGate, abi: shiftGateAbi, functionName: "passStatus", args: [p.label] })),
  );
  const statusByIndex = new Map(liveCandidates.map(({ index }, n) => [index, statuses[n]]));

  const passes: PassRow[] = raws.map(([index, p], i) => {
    const isLatestForLabel = latestByLabel.get(p.label) === index;
    const expired = blockTs >= Number(p.expiry);
    let state: PassState;
    let shiftStatus = "";
    if (revoked.has(index)) state = "revoked";
    else if (!isLatestForLabel || expired) state = "expired";
    else if (!sameAddress(p.registry, currentOps)) state = "killed";
    else {
      const st = statusByIndex.get(index);
      state = st?.live ? "live" : "revoked";
      shiftStatus = st?.shiftStatus ?? "";
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
      spent: spentValues[i] ?? 0n,
      state,
      shiftStatus,
      isLatestForLabel,
      requester: sameAddress(p.issuer, d.playground) ? requesterByLabel.get(p.label) : undefined,
    };
  });

  // Leads from events, then their remaining budget for today.
  const leadMap = new Map<string, { address: Address; dailyBudget: number; active: boolean }>();
  for (const log of issuerLogs) {
    if (log.eventName === "LeadUpdated") {
      leadMap.set(log.args.lead!.toLowerCase(), { address: log.args.lead!, dailyBudget: Number(log.args.dailyBudget), active: !!log.args.active });
    }
  }
  const leadList = [...leadMap.values()];
  const day = BigInt(Math.floor(blockTs / 86400));
  const issuedToday = await batched<bigint>(
    leadList.map((l) => ({ address: d.passIssuer, abi: passIssuerAbi, functionName: "issuedOnDay", args: [l.address, day] })),
  );
  const leads: Lead[] = leadList.map((l, i) => ({
    ...l,
    remaining: Math.max(0, l.dailyBudget - Number(issuedToday[i] ?? 0n)),
  }));

  // Activity feed with block timestamps. New blocks only; a handful at a time so a public RPC isn't flooded.
  const all = [...issuerLogs, ...gateLogs, ...switchLogs];
  const unseenBlocks = [...new Set(all.map((l) => l.blockNumber))].filter((n) => !blockTimes.has(n));
  for (let i = 0; i < unseenBlocks.length; i += 8) {
    const slice = unseenBlocks.slice(i, i + 8);
    const stamps = await Promise.all(slice.map(async (n) => Number((await publicClient.getBlock({ blockNumber: n })).timestamp)));
    slice.forEach((n, j) => blockTimes.set(n, stamps[j]));
  }
  const presetName = (id: number) => presets[id]?.name ?? "Pass";
  const activity: ActivityItem[] = [];
  for (const log of all) {
    const base = { key: `${log.transactionHash}-${log.logIndex}`, ts: blockTimes.get(log.blockNumber) ?? 0, blockNumber: log.blockNumber, txHash: log.transactionHash, label: "label" in log.args ? (log.args.label as string) : undefined };
    switch (log.eventName) {
      case "PassIssued":
        activity.push({ ...base, kind: "issued", title: `${presetName(log.args.presetId!)} pass issued`, detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "PassRevoked":
        activity.push({ ...base, kind: "revoked", title: "Pass revoked early", detail: `${log.args.label}.ops.${d.orgName}` });
        break;
      case "Paid":
        activity.push({ ...base, kind: "paid", title: `Customer paid ${usdc(log.args.amount!)}`, detail: `Order ${log.args.orderId!.slice(0, 10)}…` });
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
      case "TillQuarantined":
        activity.push({ ...base, kind: "incident", title: "Till aliased to quarantine", detail: "New pays revert. Refunds still go to the original payer." });
        break;
      case "TillPromoted":
        activity.push({ ...base, kind: "restored", title: "Till promoted back to live", detail: "Auditor attested the gate codehash." });
        break;
      case "Restored":
        activity.push({ ...base, kind: "restored", title: "Namespace restored (fresh registry)", detail: `Epoch ${log.args.epoch}` });
        break;
      case "LeadUpdated":
        activity.push({ ...base, kind: "lead", title: log.args.active ? "Shift lead added" : "Shift lead removed", detail: `${log.args.dailyBudget} passes per day` });
        break;
    }
  }
  const orderMap = new Map<string, Order>();
  for (const log of gateLogs) {
    if (log.eventName === "Paid") {
      orderMap.set(log.args.orderId!, {
        orderId: log.args.orderId!,
        payer: log.args.payer!,
        paid: log.args.amount!,
        refunded: 0n,
        blockNumber: log.blockNumber,
        ts: blockTimes.get(log.blockNumber) ?? 0,
        txHash: log.transactionHash,
      });
    }
  }
  for (const log of gateLogs) {
    if (log.eventName !== "Refunded") continue;
    const o = orderMap.get(log.args.orderId!);
    if (o) o.refunded += log.args.amount!;
  }
  const orders = [...orderMap.values()].sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : -1));

  activity.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? 1 : -1));

  return {
    blockTs,
    currentOps: currentOps as Address,
    org: liveOrg,
    incident,
    incidentReason,
    tillQuarantined: tillQ.v,
    hasTillAlias: tillQ.ok,
    epoch: Number(epoch),
    gateFloat,
    presets,
    passes: passes.reverse(),
    activity,
    leads,
    orders,
  };
}

export function OnShiftProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [chainOffset, setChainOffset] = useState(0);
  const passCache = useRef(new Map<number, RawPass>());
  const blockTimes = useRef(new Map<bigint, number>());
  const events = useRef<EventCache>({ tip: -1n, issuer: [], gate: [], sw: [], pg: [] });
  const inFlight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!deployment) {
      setError("no-deployment");
      return;
    }
    if (inFlight.current) return inFlight.current;
    inFlight.current = (async () => {
      try {
        const s = await loadSnapshot(passCache.current, blockTimes.current, events.current);
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
    const t = setInterval(refresh, POLL_MS);
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
