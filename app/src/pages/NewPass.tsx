import { useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { BadgeCheck, Bot, Check, ChevronLeft, Lock, Plus, Smartphone, Sparkles } from "lucide-react";
import { Button, Field, Group, KV, Row, Segmented, Switch, Tile } from "../components/ui";
import { Gate } from "../components/Gate";
import { PassCard } from "../components/PassCard";
import { useOnShift, type PassRow } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { ACTION_CHECK_IN, ACTION_REFUND, GAS_DRIP_WEI, deployment, isLocal } from "../lib/config";
import { clock, humanDuration, randomLabel, sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { passIssuerAbi } from "../generated/abis";
import { navigate } from "../App";
import { roleLook } from "./shared";

const DURATIONS = [
  { value: "90", label: "90 sec" },
  { value: "900", label: "15 min" },
  { value: "3600", label: "1 hr" },
  { value: "14400", label: "4 hr" },
  { value: "28800", label: "8 hr" },
];

const ROLE_COPY: Record<string, string> = {
  Cashier: "Refunds at the till and ticket check-in.",
  Support: "Goodwill refunds for customer support.",
  "AI agent": "An automated agent that can issue small refunds.",
  "Door staff": "Checks people in. Can't move money.",
};

export function NewPass() {
  const { snapshot, chainOffset } = useOnShift();
  const { operator, operatorRole, devices, addDevice, setDevice, run, busy, notify } = useSession();
  const s = snapshot!;
  const d = deployment!;

  const [step, setStep] = useState(1);
  const [holderChoice, setHolderChoice] = useState<string>("");
  const [pasted, setPasted] = useState("");
  const [presetId, setPresetId] = useState(0);
  const [seconds, setSeconds] = useState(isLocal ? 90 : 900);
  const [cap, setCap] = useState("50");
  const [label, setLabel] = useState(() => randomLabel());
  const [agentContext, setAgentContext] = useState("Refund agent for delayed-order disputes. Max one refund per order.");
  const [drip, setDrip] = useState(true);
  const [issued, setIssued] = useState<PassRow>();

  const preset = s.presets[presetId];
  const device = devices.find((x) => x.id === holderChoice);
  const holder: Address | undefined = holderChoice === "paste" ? (isAddress(pasted) ? (pasted as Address) : undefined) : device?.signer.address;
  const capUnits = (() => {
    try {
      return toUsdcUnits(cap || "0");
    } catch {
      return -1n;
    }
  })();
  const labelOk = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(label);
  const capOk = capUnits >= 0n && capUnits <= (preset?.maxCap ?? 0n);
  const durOk = seconds >= 30 && seconds <= (preset?.maxDuration ?? 0);
  const labelTaken = s.passes.some((p) => p.label === label && p.state === "live");
  const ends = Date.now() / 1000 + chainOffset + seconds;
  const holderName = device?.name ?? (holder ? short(holder) : "");
  const onShift = (addr: string) => s.passes.some((p) => p.state === "live" && sameAddress(p.holder, addr));

  const choosePreset = (id: number) => {
    const p = s.presets[id];
    setPresetId(id);
    setCap(String(Number(p.maxCap) / 1e6));
    if (seconds > p.maxDuration) setSeconds(Math.min(isLocal ? 90 : 900, p.maxDuration));
    setLabel(randomLabel(p.agent ? "agent" : "shift"));
  };

  const chooseHolder = (id: string) => {
    setHolderChoice(id);
    const dev = devices.find((x) => x.id === id);
    if (dev) {
      const agentPreset = s.presets.findIndex((p) => p.agent);
      if (dev.kind === "agent" && agentPreset >= 0) choosePreset(agentPreset);
      if (dev.kind === "staff" && preset?.agent) choosePreset(0);
    }
  };

  const issue = async () => {
    if (!operator || !holder) return;
    try {
      const balance = await publicClient.getBalance({ address: operator.signer.address });
      const dripValue = drip ? GAS_DRIP_WEI : 0n;
      const gasBuffer = isLocal ? 0n : 2_000_000_000_000_000n;
      if (balance < dripValue + gasBuffer) {
        notify({
          tone: "error",
          title: "Not enough ETH",
          detail: drip
            ? "This wallet needs Sepolia ETH for gas and the 0.003 ETH allowance sent to the holder."
            : "This wallet needs Sepolia ETH to pay for gas.",
        });
        return;
      }
    } catch (e) {
      notify({ tone: "error", title: "Couldn't read the wallet balance", detail: e instanceof Error ? e.message : String(e) });
      return;
    }
    const ok = await run(
      "issue",
      () =>
        send(operator.signer, {
          address: d.passIssuer,
          abi: passIssuerAbi,
          functionName: "issue",
          args: [label, holder, presetId, BigInt(seconds), capUnits, preset.agent ? agentContext : ""],
          value: drip ? GAS_DRIP_WEI : 0n,
        }),
      "Pass issued",
      `${label}.ops.${d.orgName} is live until ${clock(ends)}.`,
    );
    if (ok) {
      setIssued({
        index: -1,
        label,
        name: `${label}.ops.${d.orgName}`,
        holder,
        issuer: operator.signer.address,
        resolver: "0x0000000000000000000000000000000000000000",
        registry: s.currentOps,
        issuedAt: Math.floor(Date.now() / 1000 + chainOffset),
        expiry: Math.floor(ends),
        presetId,
        cap: capUnits,
        spent: 0n,
        state: "live",
        shiftStatus: "Starting shift",
        isLatestForLabel: true,
      });
      setStep(4);
    }
  };

  const reset = () => {
    setIssued(undefined);
    setStep(1);
    setHolderChoice("");
    setLabel(randomLabel(preset?.agent ? "agent" : "shift"));
  };

  const canIssue = operatorRole === "lead" || operatorRole === "org";
  const stepNames = ["Holder", "Role & Limits", "Review"];

  const locked = useMemo(
    () => ["Change where payouts go", "Raise their own limit", "Hand the pass to someone else", "Extend the shift"],
    [],
  );

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="large-title">{step === 4 ? "Pass Issued" : "New Pass"}</h1>
          <p className="page-sub">
            {step === 4 ? "It works now and stops by itself when the shift ends." : "Give someone exactly the authority a shift needs — for exactly as long as it lasts."}
          </p>
        </div>
      </div>

      <div className="stack">
        {!canIssue && <Gate need={["lead", "org"]} what="Passes are issued by shift leads." />}
        {s.incident && (
          <div className="status-strip alert">
            <Tile icon={Lock} tint="red" />
            <div>
              <div className="strip-title">Issuing is paused</div>
              <div className="small secondary">Break glass is active. Restore the namespace from Security first.</div>
            </div>
          </div>
        )}

        {step < 4 && (
          <div className="steps">
            {stepNames.map((n, i) => (
              <div key={n} className={`step ${step > i + 1 ? "done" : step === i + 1 ? "now" : ""}`}>
                {n}
              </div>
            ))}
          </div>
        )}

        {step === 1 && (
          <>
            <Group title="Devices on this computer" footer="Each device holds its own key in this browser. Passes are sent to the device, not to a person's account.">
              {devices.map((x) => (
                <Row
                  key={x.id}
                  icon={x.kind === "agent" ? Bot : Smartphone}
                  tint={x.kind === "agent" ? "graphite" : "blue"}
                  title={x.name}
                  subtitle={`${x.kind === "agent" ? "AI agent" : "Staff phone"} · ${short(x.signer.address)}`}
                  trailing={
                    <>
                      {onShift(x.signer.address) && <span className="badge green">On shift</span>}
                      <span className={`radio ${holderChoice === x.id ? "on" : ""}`}>{holderChoice === x.id && <Check size={13} strokeWidth={3} />}</span>
                    </>
                  }
                  onClick={() => chooseHolder(x.id)}
                />
              ))}
              <Row icon={Plus} tint="green" title="Set up a staff phone" subtitle="Creates the holder's key in this browser. The pass is issued on chain to that address." onClick={() => chooseHolder(addDevice(`Staff phone ${devices.filter((x) => x.kind === "staff").length + 1}`, "staff").id)} />
              <Row icon={Plus} tint="graphite" title="Set up an AI agent" subtitle="Creates the agent's key in this browser. The pass is issued on chain to that address." onClick={() => chooseHolder(addDevice(`Agent ${devices.filter((x) => x.kind === "agent").length + 1}`, "agent").id)} />
            </Group>

            <Group title="Someone else's device" footer="On a real shift the staff member opens Staff App on their own phone and shows you its device code.">
              <Row
                icon={Smartphone}
                tint="indigo"
                title="Paste a device code"
                trailing={<span className={`radio ${holderChoice === "paste" ? "on" : ""}`}>{holderChoice === "paste" && <Check size={13} strokeWidth={3} />}</span>}
                onClick={() => setHolderChoice("paste")}
              />
              {holderChoice === "paste" && (
                <div style={{ padding: "0 16px 14px" }}>
                  <input className="input mono" placeholder="0x…" value={pasted} onChange={(e) => setPasted(e.target.value.trim())} autoFocus />
                </div>
              )}
            </Group>

            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button variant="primary" size="lg" disabled={!holder} onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 2 && preset && (
          <>
            <Group title="Role">
              {s.presets
                .filter((p) => p.active)
                .map((p) => {
                  const look = roleLook(p);
                  return (
                    <Row
                      key={p.id}
                      icon={look.icon}
                      tint={look.tint}
                      title={p.name}
                      subtitle={`${ROLE_COPY[p.name] ?? ""} ${p.maxCap > 0n ? `Up to ${usdc(p.maxCap)}` : ""}, max ${humanDuration(p.maxDuration)}.`}
                      trailing={<span className={`radio ${presetId === p.id ? "on" : ""}`}>{presetId === p.id && <Check size={13} strokeWidth={3} />}</span>}
                      onClick={() => choosePreset(p.id)}
                    />
                  );
                })}
            </Group>

            <Group title="Shift length" footer={`Ends at ${clock(ends)}. Passes can't be extended — a longer shift gets a new pass.`} pad>
              <Segmented
                block
                value={String(seconds)}
                onChange={(v) => setSeconds(Number(v))}
                options={DURATIONS.filter((x) => Number(x.value) <= preset.maxDuration)}
              />
            </Group>

            <Group pad>
              <div className="stack-sm">
                <Field label="Spending limit for this shift" hint={preset.maxCap > 0n ? `Role maximum ${usdc(preset.maxCap)}.` : "This role can't move money."}>
                  <div className="affix">
                    <input className="input" inputMode="decimal" value={preset.maxCap > 0n ? cap : "0"} disabled={preset.maxCap === 0n} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
                    <span className="suffix">USDC</span>
                  </div>
                </Field>
                <Field label="Pass name" hint={labelTaken ? "That name is on shift right now." : labelOk ? `${label}.ops.${d.orgName}` : "Lowercase letters, numbers and hyphens."}>
                  <div className="affix">
                    <input className="input" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} />
                    <span className="suffix">.ops.{d.orgName}</span>
                  </div>
                </Field>
                {preset.agent && (
                  <Field label="What this agent does" hint="Published on the pass (ENSIP-26 agent-context) so anyone checking the agent can read it.">
                    <textarea className="input" rows={2} value={agentContext} onChange={(e) => setAgentContext(e.target.value)} />
                  </Field>
                )}
              </div>
            </Group>

            <div className="row spread">
              <Button variant="plain" icon={ChevronLeft} onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" size="lg" disabled={!labelOk || !capOk || !durOk || labelTaken} onClick={() => setStep(3)}>
                Review
              </Button>
            </div>
          </>
        )}

        {step === 3 && preset && (
          <>
            <Group pad>
              <p className="summary-sentence">
                <b>{holderName}</b> can act for <b>{d.orgName}</b> as <b>{preset.name.toLowerCase()}</b>
                {preset.actions & ACTION_REFUND && capUnits > 0n ? (
                  <>
                    , refunding up to <b>{usdc(capUnits)}</b>
                  </>
                ) : null}
                , until <b>{clock(ends)}</b>. After that the pass stops working on its own.
              </p>
            </Group>
            <Group title="Details">
              <KV
                rows={[
                  ["Name", `${label}.ops.${d.orgName}`],
                  ["Holder", holderName],
                  ["Role", preset.name],
                  ["Length", humanDuration(seconds)],
                  ["Can do", [preset.actions & ACTION_REFUND ? `Refund ≤ ${usdc(capUnits)}` : "", preset.actions & ACTION_CHECK_IN ? "Check in" : "", "Update status"].filter(Boolean).join(" · ")],
                ]}
              />
            </Group>
            <Group title="Locked for the holder">
              {locked.map((l) => (
                <Row key={l} icon={Lock} tint="soft" title={l} plain />
              ))}
            </Group>
            <Group footer="Sent with the pass so the holder never needs a faucet or their own ETH.">
              <Row title="Include gas allowance" subtitle={isLocal ? "0.01 ETH" : "0.003 Sepolia ETH"} trailing={<Switch on={drip} onChange={setDrip} label="Include gas allowance" />} />
            </Group>
            <div className="row spread">
              <Button variant="plain" icon={ChevronLeft} onClick={() => setStep(2)}>
                Back
              </Button>
              <Button variant="primary" size="lg" icon={Sparkles} loading={busy === "issue"} disabled={!canIssue || s.incident || !holder} onClick={issue}>
                Issue Pass
              </Button>
            </div>
          </>
        )}

        {step === 4 && issued && (
          <>
            <div style={{ maxWidth: 380, margin: "0 auto", width: "100%" }}>
              <PassCard pass={issued} preset={preset} />
            </div>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              {device && (
                <Button
                  variant="primary"
                  icon={Smartphone}
                  onClick={() => {
                    setDevice(device.id);
                    navigate("device");
                  }}
                >
                  Open on {device.name}
                </Button>
              )}
              <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: issued.name })}>
                Public Check
              </Button>
              <Button onClick={reset}>Issue Another</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
