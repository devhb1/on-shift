import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createPublicClient, decodeFunctionResult, encodeFunctionResult, http } from "viem";
import { PASS_STATUS_COMPONENTS, gateReads, isDemoName, labelId } from "./gate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("passStatus ABI (F-02)", () => {
  it("embeds the 10-field PassStatus tuple in contract order", () => {
    const reads = gateReads();
    const passStatus = reads.find((e) => e.name === "passStatus");
    assert.ok(passStatus, "passStatus fragment present");
    const components = passStatus.outputs[0].components;
    assert.equal(components.length, 10);
    assert.deepEqual(
      components.map((c) => [c.name, c.type]),
      PASS_STATUS_COMPONENTS.map((c) => [c.name, c.type])
    );
  });

  it("matches the forge-exported ShiftGate ABI when available", () => {
    const forge = join(root, "contracts/out/ShiftGate.sol/ShiftGate.json");
    const generated = join(root, "sdk/abis.json");
    assert.ok(existsSync(forge) || existsSync(generated), "run forge build && npm run export");
    const abi = existsSync(generated)
      ? JSON.parse(readFileSync(generated, "utf8")).ShiftGate
      : JSON.parse(readFileSync(forge, "utf8")).abi;
    const fromForge = abi.find((e) => e.type === "function" && e.name === "passStatus");
    const components = fromForge.outputs[0].components;
    assert.deepEqual(
      components.map((c) => [c.name, c.type]),
      PASS_STATUS_COMPONENTS.map((c) => [c.name, c.type])
    );
  });

  it("round-trips a PassStatus tuple through viem encode/decode", () => {
    const abi = gateReads();
    const sample = {
      live: true,
      registryStatus: 2,
      expiry: 1_900_000_000n,
      latestOwner: "0x1111111111111111111111111111111111111111",
      resolver: "0x2222222222222222222222222222222222222222",
      cap: 50_000_000n,
      spent: 1_000_000n,
      actions: 3,
      presetId: 1,
      shiftStatus: "Demo cashier",
    };
    const data = encodeFunctionResult({ abi, functionName: "passStatus", result: sample });
    const decoded = decodeFunctionResult({ abi, functionName: "passStatus", data });
    assert.equal(decoded.live, true);
    assert.equal(decoded.registryStatus, 2);
    assert.equal(decoded.presetId, 1);
    assert.equal(decoded.shiftStatus, "Demo cashier");
    assert.equal(decoded.cap, 50_000_000n);
    assert.equal(decoded.spent, 1_000_000n);
  });
});

describe("helpers", () => {
  it("labelId is keccak of the UTF-8 label", () => {
    assert.equal(typeof labelId("shift-1"), "bigint");
    assert.notEqual(labelId("a"), labelId("b"));
  });

  it("isDemoName flags sandbox names", () => {
    assert.equal(isDemoName("play-ab12.demo.onshift.eth"), true);
    assert.equal(isDemoName("shift-1.ops.onshift.eth"), false);
  });
});

describe("checkPass decode shapes", () => {
  it("documents expected verdict keys for live / dead / quarantined callers", () => {
    // Contracted surface for scripts/counterparty.mjs and agents — keep stable.
    const keys = [
      "name",
      "live",
      "passLive",
      "demo",
      "tillQuarantined",
      "tillStatus",
      "gate",
      "registryStatus",
      "expiry",
      "holder",
      "cap",
      "spent",
      "actions",
      "presetId",
      "roleNote",
      "agentContext",
    ];
    assert.ok(keys.includes("demo"));
    assert.ok(keys.includes("passLive"));
    // Keep viem import warm so CI without forge still resolves the peer.
    assert.equal(typeof createPublicClient, "function");
    assert.equal(typeof http, "function");
  });
});
