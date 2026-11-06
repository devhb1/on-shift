// A second agent that walks away from a revoked or expired OnShift name for free.
// Usage: node scripts/counterparty.mjs play-1
//        node scripts/counterparty.mjs play-1.ops.onshift.eth
// Exit 0 = live, will transact. Exit 2 = refuse.
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { checkPass, loadDeployment } from "../sdk/gate.mjs";

const raw = process.argv[2];
if (!raw) {
  console.error("usage: node scripts/counterparty.mjs <label-or-name>");
  process.exit(1);
}
const d = loadDeployment("11155111");
const suffix = `.ops.${d.orgName}`;
const label = raw.endsWith(suffix) ? raw.slice(0, raw.length - suffix.length) : raw.split(".")[0];
const pub = createPublicClient({
  chain: sepolia,
  transport: http(process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.ethpandaops.io"),
});

const verdict = await checkPass(pub, d, label);
if (!verdict.live) {
  console.log(`counterparty: refuse ${verdict.name} (not on shift)`);
  process.exit(2);
}
console.log(`counterparty: ${verdict.name} is live until ${new Date(verdict.expiry * 1000).toISOString()}`);
console.log(`holder ${verdict.holder} remaining cap ${verdict.cap - verdict.spent}`);
