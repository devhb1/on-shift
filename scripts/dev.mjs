// One command local demo: anvil (1s blocks) -> deploy -> export ABIs -> Vite dev server.
import { spawn, execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = "http://127.0.0.1:8545";
// Anvil's well-known dev key #0 (public test mnemonic). Local chain only - never use on a real network.
const ORG_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const children = [];
const stop = () => {
  for (const c of children) c.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function rpcReady() {
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

if (await rpcReady()) {
  console.log("> Reusing the chain already running on :8545");
} else {
  console.log("> Starting anvil (1 second blocks so countdowns and expiry track wall-clock time)");
  const anvil = spawn("anvil", ["--block-time", "1", "--silent"], { stdio: "inherit" });
  children.push(anvil);
  for (let i = 0; i < 50 && !(await rpcReady()); i++) await new Promise((r) => setTimeout(r, 200));
  if (!(await rpcReady())) throw new Error("anvil did not start - is Foundry installed? (curl -L https://foundry.paradigm.xyz | bash)");
}

console.log("> Deploying OnShift");
execSync(`forge script script/Deploy.s.sol --rpc-url ${RPC} --broadcast --private-key ${ORG_KEY}`, {
  cwd: join(root, "contracts"),
  stdio: ["ignore", "inherit", "inherit"],
});
execSync("node scripts/export-abis.mjs", { cwd: root, stdio: "inherit" });

console.log("> Starting the web app on http://localhost:5173");
const vite = spawn("npm", ["--workspace", "app", "run", "dev"], { cwd: root, stdio: "inherit" });
children.push(vite);
vite.on("exit", stop);
