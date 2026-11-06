// Live end-to-end check of OnShift on Sepolia ENSv2. Issues a 90-second Cashier pass to a fresh burner,
// exercises every allowed and forbidden action, resolves the pass through the ENS Universal Resolver,
// then waits for expiry and confirms the gate refuses — with no revoke transaction.
//
//   SEPOLIA_PRIVATE_KEY=... node scripts/sepolia-smoke.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, keccak256, namehash, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(root, "contracts/deployments/11155111.json"), "utf8"));
const abi = (n) => JSON.parse(readFileSync(join(root, "contracts/out", `${n}.sol`, `${n}.json`), "utf8")).abi;
const issuerAbi = abi("PassIssuer");
const gateAbi = abi("ShiftGate");
const resolverAbi = abi("PermissionedResolver");
const registryAbi = abi("PermissionedRegistry");
const errors = [...issuerAbi, ...gateAbi, ...resolverAbi, ...registryAbi].filter((x) => x.type === "error");
const UNIVERSAL_RESOLVER = "0x85eDf8B6b7D4211e2b07AA687506B746357B92cf"; // UniversalResolverV2

const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.ethpandaops.io");
const pub = createPublicClient({ chain: sepolia, transport });
const lead = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(process.env.SEPOLIA_PRIVATE_KEY) });
const staff = createWalletClient({ chain: sepolia, transport, account: privateKeyToAccount(generatePrivateKey()) });
const ATTACKER = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const CUSTOMER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const label = `shift-${Math.floor(1000 + Math.random() * 9000)}`;
const name = `${label}.ops.${d.orgName}`;
const node = namehash(name);
let failures = 0;

async function send(wallet, address, a, functionName, args, value) {
  const { request } = await pub.simulateContract({ account: wallet.account, address, abi: [...a, ...errors], functionName, args, value });
  const gas = await pub.estimateContractGas({ account: wallet.account, address, abi: [...a, ...errors], functionName, args, value });
  const hash = await wallet.writeContract({ ...request, gas: (gas * 13n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}

async function expectRevert(what, wallet, address, a, functionName, args, expected) {
  try {
    await pub.simulateContract({ account: wallet.account, address, abi: [...a, ...errors], functionName, args });
    console.log(`   ✗ ${what}: was ALLOWED`);
    failures++;
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    const got = r?.data?.errorName ?? "unknown";
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`   ${ok ? "✓" : "✗"} ${what}: blocked with ${got}${ok ? "" : ` (expected ${expected})`}`);
  }
}

const check = (cond, msg) => {
  if (!cond) failures++;
  console.log(`   ${cond ? "✓" : "✗"} ${msg}`);
};

console.log(`\nOnShift live check on Sepolia ENSv2 — ${name}\n`);
console.log("1. Shift lead issues a 90-second Cashier pass (cap $50) with a gas allowance");
const issueTx = await send(lead, d.passIssuer, issuerAbi, "issue", [label, staff.account.address, 0, 90n, 50_000_000n, ""], 3_000_000_000_000_000n);
console.log(`   ✓ issued  https://sepolia.etherscan.io/tx/${issueTx}`);
// public RPCs are load-balanced: wait until the node we read from has seen the issuance block
async function eventually(read, ok) {
  for (let i = 0; i < 10; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return read();
}
const st = await eventually(() => pub.readContract({ address: d.shiftGate, abi: gateAbi, functionName: "passStatus", args: [label] }), (v) => v.live);
check(st.live, `gate says ON SHIFT, cap $${Number(st.cap) / 1e6}`);

console.log("2. ENS resolution through the Universal Resolver");
try {
  const role = await pub.getEnsText({ name: normalize(name), key: "role", universalResolverAddress: UNIVERSAL_RESOLVER });
  const org = await pub.getEnsText({ name: normalize(name), key: "org", universalResolverAddress: UNIVERSAL_RESOLVER });
  check(role === "Cashier" && org === d.orgName, `resolves: role="${role}", org="${org}"`);
} catch (e) {
  console.log(`   ! Universal Resolver lookup failed: ${e.shortMessage ?? e.message}`);
}

console.log("3. The holder uses the pass");
const resolver = st.resolver;
await send(staff, resolver, resolverAbi, "setText", [node, "shift.status", "Lane 3"]);
// public RPCs are load-balanced; give a lagging node a moment to see the new block
let status = "";
for (let i = 0; i < 5 && status !== "Lane 3"; i++) {
  status = await pub.readContract({ address: resolver, abi: resolverAbi, functionName: "text", args: [node, "shift.status"] });
  if (status !== "Lane 3") await new Promise((r) => setTimeout(r, 3000));
}
check(status === "Lane 3", "status updated to “Lane 3”");
const refundTx = await send(staff, d.shiftGate, gateAbi, "refund", [label, CUSTOMER, 10_000_000n, keccak256(toHex(`${label}-1`))]);
console.log(`   ✓ refunded $10  https://sepolia.etherscan.io/tx/${refundTx}`);

console.log("4. The holder turns rogue");
await expectRevert("redirect payouts", staff, resolver, resolverAbi, "setAddr", [node, 60n, ATTACKER], "EACUnauthorizedAccountRoles");
await expectRevert("raise own cap", staff, resolver, resolverAbi, "setData", [node, "pass.scope", "0x01"], "EACUnauthorizedAccountRoles");
const state = await pub.readContract({ address: d.opsRegistry, abi: registryAbi, functionName: "getState", args: [BigInt(keccak256(toHex(label)))] });
await expectRevert("transfer the pass", staff, d.opsRegistry, registryAbi, "safeTransferFrom", [staff.account.address, ATTACKER, state.tokenId, 1n, "0x"], "TransferDisallowed");
await expectRevert("refund over the cap", staff, d.shiftGate, gateAbi, "refund", [label, ATTACKER, 41_000_000n, keccak256(toHex(`${label}-2`))], "OverCap");

console.log("5. Nobody sends a transaction. Waiting for the shift to end…");
const expiry = Number(state.expiry);
for (;;) {
  const now = Number((await pub.getBlock()).timestamp);
  if (now >= expiry) break;
  await new Promise((r) => setTimeout(r, Math.min(15, expiry - now + 2) * 1000));
}
await expectRevert("refund after the shift", staff, d.shiftGate, gateAbi, "refund", [label, CUSTOMER, 1_000_000n, keccak256(toHex(`${label}-3`))], "PassNotLive");
const after = await pub.readContract({ address: d.shiftGate, abi: gateAbi, functionName: "passStatus", args: [label] });
check(!after.live, "gate says NOT ON SHIFT");
check((await pub.readContract({ address: d.opsRegistry, abi: registryAbi, functionName: "getResolver", args: [label] })) === "0x0000000000000000000000000000000000000000", "registry no longer points at the pass resolver");

console.log(failures ? `\n${failures} check(s) FAILED\n` : "\nAll checks passed on Sepolia ENSv2.\n");
process.exit(failures ? 1 : 0);
