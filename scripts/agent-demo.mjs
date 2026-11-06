// AI-agent demo: a shift lead issues agent-XXXX.ops.onshift.eth to an agent wallet with a $20 cap and a
// 10-minute life. A customer pays a $50 order; the "agent" then keeps refunding $5 against it until the
// chain stops it with OverCap.
// Run against the local stack started by `npm run dev`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const abi = (name) => JSON.parse(readFileSync(join(root, "contracts/out", `${name}.sol`, `${name}.json`), "utf8")).abi;
const d = JSON.parse(readFileSync(join(root, "contracts/deployments/31337.json"), "utf8"));

// Anvil's public dev keys #1 (shift lead) and #2 (agent wallet). Local chain only.
const LEAD_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const AGENT_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
// Anvil's public dev key #3, the paying customer.
const CUSTOMER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

const issuerAbi = abi("PassIssuer");
const gateAbi = abi("ShiftGate");
const usdcAbi = abi("MockUSDC");
const allErrors = [...issuerAbi, ...gateAbi, ...abi("PermissionedRegistry")].filter((x) => x.type === "error");

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const lead = createWalletClient({ account: privateKeyToAccount(LEAD_KEY), chain: foundry, transport: http(RPC) });
const agent = createWalletClient({ account: privateKeyToAccount(AGENT_KEY), chain: foundry, transport: http(RPC) });
const customer = createWalletClient({ account: privateKeyToAccount(CUSTOMER_KEY), chain: foundry, transport: http(RPC) });

async function call(wallet, address, abi, functionName, args) {
  const { request } = await pub.simulateContract({
    account: wallet.account,
    address,
    abi: [...abi, ...allErrors],
    functionName,
    args,
  });
  const hash = await wallet.writeContract(request);
  return pub.waitForTransactionReceipt({ hash });
}

const errorName = (e) => {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.shortMessage;
  }
  throw e;
};

const label = `agent-${Math.floor(1000 + Math.random() * 9000)}`;
const name = `${label}.ops.${d.orgName}`;

console.log(`\n1. Shift lead issues ${name} (AI agent preset, $20 cap, 10 minutes)`);
await call(lead, d.passIssuer, issuerAbi, "issue", [
  label,
  agent.account.address,
  2,
  600n,
  20_000_000n,
  "Autonomous refund agent for delayed orders",
]);

console.log("2. A customer pays a $50 order");
await call(customer, d.usdc, usdcAbi, "mint", [customer.account.address, 50_000_000n]);
await call(customer, d.usdc, usdcAbi, "approve", [d.shiftGate, 50_000_000n]);
const paid = await call(customer, d.shiftGate, gateAbi, "pay", [50_000_000n]);
const orderId = paid.logs.find((l) => l.address.toLowerCase() === d.shiftGate.toLowerCase() && l.topics.length === 3).topics[1];

console.log("3. The agent refunds $5 at a time against that order\n");
for (let i = 1; i <= 10; i++) {
  try {
    await call(agent, d.shiftGate, gateAbi, "refund", [label, orderId, 5_000_000n]);
    console.log(`   refund #${i}: $5 back to the customer`);
  } catch (e) {
    console.log(`   refund #${i}: REVERT ${errorName(e)}  <- the cap in the agent's ENS record stopped it`);
    break;
  }
}

const st = await pub.readContract({ address: d.shiftGate, abi: gateAbi, functionName: "passStatus", args: [label] });
console.log(
  `\n4. Public view of ${name}: ${st.live ? "ON SHIFT" : "NOT ON SHIFT"}, spent $${Number(st.spent) / 1e6} of $${Number(st.cap) / 1e6}`,
);
console.log("   It expires by itself in 10 minutes - nobody needs to revoke it.\n");
