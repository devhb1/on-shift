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

function read(): PlayLoop | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as PlayLoop;
    if (!v?.name || !v?.label) return undefined;
    return v;
  } catch {
    return undefined;
  }
}

function write(next: PlayLoop | undefined) {
  try {
    if (!next) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("onshift-playloop"));
}

export function getPlayLoop() {
  return read();
}

export function setPlayIssued(input: { label: string; name: string; hash?: string; block?: string }) {
  write({ ...input });
}

export function setPlayOrder(orderId: string) {
  const cur = read();
  if (!cur) return;
  write({ ...cur, orderId, paidAt: Date.now() });
}

export function setPlayRefunded() {
  const cur = read();
  if (!cur) return;
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
