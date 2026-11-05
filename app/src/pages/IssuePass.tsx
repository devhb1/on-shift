import { useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { Bot, CheckCircle2, Lock, PlusCircle, Smartphone, Sparkles, UserRound } from "lucide-react";
import { Button, Card, CopyButton, Field, Qr } from "../components/ui";
import { RoleGate } from "../components/RoleGate";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { deployment, GAS_DRIP_WEI, ACTION_CHECK_IN, ACTION_REFUND } from "../lib/config";
import { humanDuration, randomLabel, short, toUsdcUnits, usdc } from "../lib/format";
import { passIssuerAbi } from "../generated/abis";
import { navigate } from "../App";

const DURATIONS = [90, 15 * 60, 60 * 60, 4 * 60 * 60, 8 * 60 * 60];

export function IssuePass() {
  const { snapshot } = useOnShift();
  const { active, staffDevices, identities, addDevice, setActive, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const agentIdentity = identities.find((i) => i.kind === "agent")!;

  const [presetId, setPresetId] = useState(0);
  const preset = s.presets[presetId];
  const [label, setLabel] = useState(() => randomLabel());
  const [holderChoice, setHolderChoice] = useState<string>(staffDevices[0]?.id ?? "new");
  const [customHolder, setCustomHolder] = useState("");
  const [seconds, setSeconds] = useState(90);
  const [cap, setCap] = useState("50");
  const [drip, setDrip] = useState(true);
  const [agentContext, setAgentContext] = useState("Refund bot for delayed-order disputes. Max one refund per order.");
  const [issued, setIssued] = useState<{ name: string; holder: string } | null>(null);

  const holder: Address | undefined = useMemo(() => {
    if (holderChoice === "agent") return agentIdentity.address;
    if (holderChoice === "custom") return isAddress(customHolder) ? (customHolder as Address) : undefined;
    return staffDevices.find((x) => x.id === holderChoice)?.address;
  }, [holderChoice, customHolder, staffDevices, agentIdentity]);

  const capUnits = (() => {
    try {
      return toUsdcUnits(cap);
    } catch {
      return -1n;
    }
  })();
  const labelOk = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(label);
  const capOk = capUnits >= 0n && capUnits <= (preset?.maxCap ?? 0n);
  const durOk = seconds >= 30 && seconds <= (preset?.maxDuration ?? 0);
  const valid = labelOk && capOk && durOk && !!holder && !s.incident;

  const choosePreset = (id: number) => {
    const p = s.presets[id];
    setPresetId(id);
    setCap(String(Number(p.maxCap) / 1e6));
    if (seconds > p.maxDuration) setSeconds(Math.min(90, p.maxDuration));
    if (p.agent) {
      setLabel(randomLabel("agent"));
      setHolderChoice("agent");
    } else if (label.startsWith("agent-")) setLabel(randomLabel());
  };

  const issue = async () => {
    if (!holder) return;
    const name = `${label}.ops.${d.orgName}`;
    const ok = await run(
      "issue",
      () =>
        send(active.privateKey, {
          address: d.passIssuer,
          abi: passIssuerAbi,
          functionName: "issue",
          args: [label, holder, presetId, BigInt(seconds), capUnits, preset.agent ? agentContext : ""],
          value: drip ? GAS_DRIP_WEI : 0n,
        }),
      "Pass issued",
      `${name} is live for ${humanDuration(seconds)}.`,
    );
    if (ok) {
      setIssued({ name, holder });
      setLabel(randomLabel(preset.agent ? "agent" : "shift"));
    }
  };

  const verifyUrl = (name: string) => `${window.location.origin}${window.location.pathname}#/verify?name=${encodeURIComponent(name)}`;

  return (
    <>
      <RoleGate kinds={["lead", "org"]} what="Issuing a pass">
        {null}
      </RoleGate>
      {s.incident && (
        <div className="banner red">
          <Lock size={18} /> Break-glass is active, so issuance is frozen. Restore the namespace first.
        </div>
      )}

      <div className="grid grid-main">
        <Card title="New pass" icon={PlusCircle}>
          <div className="stack" style={{ gap: 20 }}>
            <Field label="Role">
              <div className="segmented">
                {s.presets.filter((p) => p.active).map((p) => (
                  <button key={p.id} className={`choice ${presetId === p.id ? "selected" : ""}`} onClick={() => choosePreset(p.id)}>
                    <div className="choice-title">
                      {p.agent ? <Bot size={15} /> : <UserRound size={15} />} {p.name}
                    </div>
                    <div className="choice-sub">
                      {p.maxCap > 0n ? `up to ${usdc(p.maxCap)}` : "no spending"} · max {humanDuration(p.maxDuration)}
                    </div>
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Who gets it">
              <div className="segmented">
                {staffDevices.map((x) => (
                  <button key={x.id} className={`choice ${holderChoice === x.id ? "selected" : ""}`} onClick={() => setHolderChoice(x.id)}>
                    <div className="choice-title"><Smartphone size={15} /> {x.label}</div>
                    <div className="choice-sub mono">{short(x.address)}</div>
                  </button>
                ))}
                <button className={`choice ${holderChoice === "agent" ? "selected" : ""}`} onClick={() => setHolderChoice("agent")}>
                  <div className="choice-title"><Bot size={15} /> AI agent wallet</div>
                  <div className="choice-sub mono">{short(agentIdentity.address)}</div>
                </button>
                <button className={`choice ${holderChoice === "custom" ? "selected" : ""}`} onClick={() => setHolderChoice("custom")}>
                  <div className="choice-title">Other address</div>
                  <div className="choice-sub">Paste from a staff QR</div>
                </button>
                <button
                  className="choice"
                  onClick={() => {
                    const dev = addDevice(`Staff phone ${staffDevices.length + 1}`);
                    setHolderChoice(dev.id);
                  }}
                >
                  <div className="choice-title"><PlusCircle size={15} /> New staff device</div>
                  <div className="choice-sub">Creates a burner key in this browser</div>
                </button>
              </div>
              {holderChoice === "custom" && (
                <input className="input mono" placeholder="0x…" value={customHolder} onChange={(e) => setCustomHolder(e.target.value.trim())} />
              )}
            </Field>

            <div className="grid grid-2">
              <Field label="Pass name" hint={labelOk ? `${label}.ops.${d.orgName}` : "Lowercase letters, digits and hyphens"}>
                <div className="input-affix">
                  <input className="input" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase())} />
                  <span>.ops.{d.orgName}</span>
                </div>
              </Field>
              <Field label="Spending cap for this shift" hint={preset ? `Role maximum ${usdc(preset.maxCap)}` : ""}>
                <div className="input-affix">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={cap}
                    disabled={preset?.maxCap === 0n}
                    onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <span>USDC</span>
                </div>
              </Field>
            </div>

            <Field label={`Shift length: ${humanDuration(seconds)}`} hint="The pass ends by itself at this time. There is no renew.">
              <div className="row row-wrap">
                {DURATIONS.filter((x) => x <= (preset?.maxDuration ?? 0)).map((x) => (
                  <button key={x} className={`chip-btn ${seconds === x ? "selected" : ""}`} onClick={() => setSeconds(x)}>
                    {humanDuration(x)}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min={30}
                max={preset?.maxDuration ?? 3600}
                step={30}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
                aria-label="Shift length"
              />
            </Field>

            {preset?.agent && (
              <Field label="Agent description (ENSIP-26 agent-context record)" hint="Public: anyone verifying the agent sees this.">
                <textarea className="input" rows={2} value={agentContext} onChange={(e) => setAgentContext(e.target.value)} />
              </Field>
            )}

            <label className="row small" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={drip} onChange={(e) => setDrip(e.target.checked)} />
              Send 0.01 ETH for gas with the pass, so the holder never needs a faucet
            </label>

            <Button
              variant="primary"
              size="lg"
              icon={Sparkles}
              loading={busy === "issue"}
              disabled={!valid || !["lead", "org"].includes(active.kind)}
              onClick={issue}
            >
              Issue pass
            </Button>
          </div>
        </Card>

        <div className="stack" style={{ gap: 22 }}>
          {issued ? (
            <Card title="Pass is live" icon={CheckCircle2}>
              <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
                <div className="badge-name">{issued.name}</div>
                <Qr value={verifyUrl(issued.name)} label="Verify link" />
                <div className="small muted">Customers scan this to check the pass is real and on shift.</div>
                <div className="row row-wrap" style={{ justifyContent: "center" }}>
                  <CopyButton value={verifyUrl(issued.name)} label="Copy verify link" />
                  <button className="btn btn-sm" onClick={() => navigate("verify", { name: issued.name })}>Open verifier</button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const holderIdentity = identities.find((i) => i.address.toLowerCase() === issued.holder.toLowerCase());
                      if (holderIdentity) setActive(holderIdentity.id);
                      navigate("staff");
                    }}
                  >
                    Open as holder
                  </button>
                </div>
              </div>
            </Card>
          ) : null}
          <Card title="What the holder can do" icon={Lock}>
            <div className="stack">
              <div className="row row-wrap">
                <span className="chip allowed">Update shift status</span>
                {preset && (preset.actions & ACTION_REFUND) !== 0 && (
                  <span className="chip allowed">Refund up to {capOk ? usdc(capUnits) : "…"}</span>
                )}
                {preset && (preset.actions & ACTION_CHECK_IN) !== 0 && <span className="chip allowed">Check in tickets</span>}
              </div>
              <div className="row row-wrap">
                <span className="chip locked"><Lock size={13} /> Change payout address</span>
                <span className="chip locked"><Lock size={13} /> Transfer or lend the pass</span>
                <span className="chip locked"><Lock size={13} /> Raise own cap</span>
                <span className="chip locked"><Lock size={13} /> Extend the shift</span>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                The pass gets its own resolver (ENSv2 resolver roles cover every name on an instance), is registered with zero
                roles, and the payout address is written by the issuer only.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
