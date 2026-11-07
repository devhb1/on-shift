/** Shared Playground loop state so Try → Pay → Staff → Check stay in sync. */

const KEY = "onshift.playLoop";

export type PlayLoop = {
  label: string;
  name: string;
  hash?: string;
  block?: string;
  orderId?: string;
  paidAt?: number;
  refundedAt?: number;
};

/** Cached snapshot — useSyncExternalStore requires a stable reference when data is unchanged. */
let cachedRaw: string | null = null;
let cachedValue: PlayLoop | undefined;

function readRaw(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): PlayLoop | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as PlayLoop;
    if (typeof v?.name !== "string" || typeof v?.label !== "string") return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function refreshCache() {
  const raw = readRaw();
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  cachedValue = parse(raw);
  return cachedValue;
}

function write(next: PlayLoop | undefined) {
  const raw = next ? JSON.stringify(next) : null;
  try {
    if (!raw) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, raw);
  } catch {
    /* ignore */
  }
  cachedRaw = raw;
  cachedValue = next ? { ...next } : undefined;
  window.dispatchEvent(new Event("onshift-playloop"));
}

export function getPlayLoop() {
  return refreshCache();
}

export function setPlayIssued(input: { label: string; name: string; hash?: string; block?: string }) {
  const cur = refreshCache();
  // Same pass already tracked — only bump if we learned a new tx hash/block.
  if (cur?.name === input.name && cur.label === input.label) {
    if ((!input.hash || input.hash === cur.hash) && (!input.block || input.block === cur.block)) return;
    write({ ...cur, ...input });
    return;
  }
  write({ ...input });
}

export function setPlayOrder(orderId: string) {
  const cur = refreshCache();
  if (!cur) return;
  if (cur.orderId === orderId && cur.paidAt) return;
  write({ ...cur, orderId, paidAt: Date.now() });
}

export function setPlayRefunded() {
  const cur = refreshCache();
  if (!cur || cur.refundedAt) return;
  write({ ...cur, refundedAt: Date.now() });
}

/** 0 connect · 1 issue · 2 pay · 3 refund · 4 check */
export function playStage(connected: boolean, loop?: PlayLoop | null): number {
  if (!connected) return 0;
  if (!loop?.name) return 1;
  if (!loop.orderId) return 2;
  if (!loop.refundedAt) return 3;
  return 4;
}

export const PLAY_STEPS = ["Connect", "Issue the pass", "Pay the sandbox", "Refund it", "Check the name"] as const;

export function subscribePlayLoop(cb: () => void) {
  const on = () => cb();
  window.addEventListener("onshift-playloop", on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener("onshift-playloop", on);
    window.removeEventListener("storage", on);
  };
}
