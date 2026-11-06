// After Vite writes app/dist, copy it to dist/ at the repo root.
// Vercel looks for "dist" when Root Directory is app/, and for "app/dist" when it is the repo root.
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "app", "dist");
const to = join(root, "dist");
if (!existsSync(from)) throw new Error("app/dist missing. Vite did not write an output.");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("Copied app/dist → dist");
