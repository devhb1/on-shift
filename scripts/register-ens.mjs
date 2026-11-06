// Registers <ORG_LABEL>.eth on Sepolia ENSv2 (ETHRegistrar commit → wait → register), owned by the deployer,
// with OnShift's org registry as its subregistry and OnShift's org resolver as its resolver.
//
//   SEPOLIA_PRIVATE_KEY=... SEPOLIA_RPC_URL=... node scripts/register-ens.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, keccak256, maxUint256, parseAbi, toHex, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(root, "contracts/deployments/11155111.json"), "utf8"));
const label = d.orgName.replace(/\.eth$/, "");

const REGISTRAR = "0xa4449a0dD2b83007553D9b1d28b583A46A805a30";
const ETH_REGISTRY = "0x67b728a792e789a8978b30cF1b3b641f19354b43";
const DURATION = 365n * 24n * 3600n;

const registrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);
const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const registryAbi = parseAbi([
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
]);

const key = process.env.SEPOLIA_PRIVATE_KEY;
if (!key) throw new Error("Set SEPOLIA_PRIVATE_KEY");
const transport = http(process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.ethpandaops.io");
const account = privateKeyToAccount(key);
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });

async function tx(address, abi, functionName, args) {
  const gas = await pub.estimateContractGas({ account, address, abi, functionName, args });
  const hash = await wallet.writeContract({ address, abi, functionName, args, gas: (gas * 13n) / 10n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} failed: ${hash}`);
  console.log(`   ${functionName} ✓ ${hash}`);
  return r;
}

const current = await pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [label] });
if (current.toLowerCase() === d.parentRegistry.toLowerCase()) {
  console.log(`${label}.eth already points at OnShift's registry. Nothing to do.`);
  process.exit(0);
}
if (!(await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "isAvailable", args: [label] }))) {
  throw new Error(`${label}.eth is not available. Redeploy with ORG_LABEL=<other> and rerun.`);
}

const [base, premium] = await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "getRegisterPrice", args: [label, DURATION, d.usdc] });
console.log(`Registering ${label}.eth for 1 year: ${Number(base + premium) / 1e6} test USDC`);

console.log("1. Fund and approve test USDC (ENSv2 testnet MockUSDC has an open mint)");
await tx(d.usdc, erc20Abi, "mint", [account.address, base + premium + 1_000_000n]);
await tx(d.usdc, erc20Abi, "approve", [REGISTRAR, maxUint256]);

console.log("2. Commit");
const secret = keccak256(toHex(`onshift-${Date.now()}-${Math.random()}`));
const commitment = await pub.readContract({
  address: REGISTRAR,
  abi: registrarAbi,
  functionName: "makeCommitment",
  args: [label, account.address, secret, d.parentRegistry, d.parentResolver, DURATION, zeroHash],
});
await tx(REGISTRAR, registrarAbi, "commit", [commitment]);

const age = await pub.readContract({ address: REGISTRAR, abi: registrarAbi, functionName: "MIN_COMMITMENT_AGE" });
console.log(`3. Wait ${Number(age) + 15}s for the commitment to mature`);
await new Promise((r) => setTimeout(r, (Number(age) + 15) * 1000));

console.log("4. Register");
await tx(REGISTRAR, registrarAbi, "register", [label, account.address, secret, d.parentRegistry, d.parentResolver, DURATION, d.usdc, zeroHash]);

const [sub, res] = await Promise.all([
  pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getSubregistry", args: [label] }),
  pub.readContract({ address: ETH_REGISTRY, abi: registryAbi, functionName: "getResolver", args: [label] }),
]);
console.log(`\n${label}.eth → subregistry ${sub} (OnShift org registry: ${sub.toLowerCase() === d.parentRegistry.toLowerCase() ? "yes" : "NO"})`);
console.log(`${label}.eth → resolver    ${res} (OnShift org resolver: ${res.toLowerCase() === d.parentResolver.toLowerCase() ? "yes" : "NO"})`);
