// Copies committed deployment files into the web app. No Foundry.
// The local Anvil file (31337) is skipped so a hosted build cannot offer a chain the visitor does not have.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const deploymentsDir = join(root, "contracts", "deployments");
const target = join(root, "app", "src", "generated");
const abis = join(target, "abis.ts");

if (!existsSync(abis)) {
  throw new Error("Missing app/src/generated/abis.ts. Run npm run export after forge build, and commit the result.");
}

mkdirSync(target, { recursive: true });
const deployments = {};
for (const file of readdirSync(deploymentsDir).filter((name) => name.endsWith(".json"))) {
  const deployment = JSON.parse(readFileSync(join(deploymentsDir, file), "utf8"));
  if (deployment.chainId === 31337 && process.env.INCLUDE_LOCAL !== "1") continue;
  deployments[String(deployment.chainId)] = deployment;
}
if (Object.keys(deployments).length === 0) {
  throw new Error("No deployment JSON in contracts/deployments. Deploy before building the web app.");
}
writeFileSync(join(target, "deployments.json"), JSON.stringify(deployments, null, 2) + "\n");
console.log(`Prepared web app for chain(s) ${Object.keys(deployments).join(", ")}`);
