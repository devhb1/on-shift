import { formatUnits, parseUnits, type Address } from "viem";
import { USDC_DECIMALS } from "./config";

export const usdc = (v: bigint) => {
  const n = Number(formatUnits(v, USDC_DECIMALS));
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

export const toUsdcUnits = (v: string) => parseUnits(v || "0", USDC_DECIMALS);

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const sameAddress = (a?: Address | string, b?: Address | string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function duration(seconds: number) {
  if (seconds <= 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function humanDuration(seconds: number) {
  if (seconds < 120) return `${seconds}s`;
  if (seconds < 3600) {
    const rest = seconds % 60;
    return rest ? `${Math.floor(seconds / 60)} min ${rest}s` : `${seconds / 60} min`;
  }
  const h = seconds / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

export function timeAgo(seconds: number) {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

/** Edit distance, used to flag look-alike organisations (acrne.eth vs acme.eth). */
export function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function randomLabel(prefix = "shift") {
  return `${prefix}-${String(Math.floor(1000 + Math.random() * 9000))}`;
}
