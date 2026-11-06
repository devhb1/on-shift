import { useState } from "react";
import { AlertOctagon, ArrowLeftRight, Clock3, KeyRound, Layers, Lock, RotateCcw, ShieldAlert, ShieldCheck, Wallet } from "lucide-react";
import { Button, Field, Group, Row, Sheet, Tile } from "../components/ui";
import { Gate } from "../components/Gate";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { deployment, isLocal } from "../lib/config";
import { clock, plural, short } from "../lib/format";
import { incidentSwitchAbi } from "../generated/abis";

export function Security() {
  const { snapshot } = useOnShift();
  const { operator, operatorRole, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const [sheet, setSheet] = useState(false);
  const [reason, setReason] = useState("Fake support agents reported in our community chat");
  const [typed, setTyped] = useState("");
  const live = s.passes.filter((p) => p.state === "live").length;
  const isOrg = operatorRole === "org";

  const breakGlass = async () => {
    if (!operator) return;
    setSheet(false);
    setTyped("");
    await run(
      "break",
      () => send(operator.signer, { address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "breakGlass", args: [reason] }),
      "Every pass stopped",
      "One transaction. Public checks now show incident mode.",
    );
  };

  const restore = () =>
    operator &&
    run(
      "restore",
      () => send(operator.signer, { address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "restore" }),
      "Namespace restored",
      "A fresh registry now serves ops. Old passes stay dead.",
    );

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="large-title">Security</h1>
          <p className="page-sub">What OnShift guarantees, and the switch for when something goes wrong.</p>
        </div>
      </div>

      <div className="stack">
        <Group pad>
          <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
            <Tile icon={s.incident ? ShieldAlert : ShieldCheck} tint={s.incident ? "red" : "green"} large />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>{s.incident ? "Incident Mode" : "Normal Operation"}</div>
              <p className="secondary" style={{ marginTop: 4 }}>
                {s.incident
                  ? `Every pass is stopped. Reason: ${s.incidentReason || "not given"}.`
                  : `${plural(live, "pass")} on shift. If keys leak or impostors appear, you can stop all of them in one transaction.`}
              </p>
              <div style={{ marginTop: 16 }}>
                {!s.incident ? (
                  <Button variant="destructive" icon={AlertOctagon} disabled={!isOrg} loading={busy === "break"} onClick={() => setSheet(true)}>
                    Stop All Passes…
                  </Button>
                ) : (
                  <Button variant="primary" icon={RotateCcw} disabled={!isOrg} loading={busy === "restore"} onClick={restore}>
                    Restore with Fresh Namespace
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Group>
        {!isOrg && <Gate need={["org"]} what="Only the organisation wallet can stop or restore the namespace." />}

        <Group
          title="How Stop All Passes works"
          footer={`Restoring never points back at the old registry — that would bring every old pass back. It deploys a new one, so passes from before the incident stay dead.${s.epoch ? ` Restored ${plural(s.epoch, "time")} so far.` : ""}`}
        >
          <Row icon={ArrowLeftRight} tint="red" title={`Re-points ops.${d.orgName}`} subtitle="To an empty registry, in one transaction" />
          <Row icon={Layers} tint="orange" title="Every pass fails at once" subtitle="The payment gate reads the live pointer on every call" />
          <Row icon={AlertOctagon} tint="red" title="Customers are warned" subtitle={`${d.orgName} publishes ops.status = incident for public checks`} />
        </Group>

        {!isLocal && (
          <Group title="Who holds the keys" footer="A later deployment can move this role to a multisig. This one has not.">
            <Row icon={KeyRound} tint="orange" title={`Organisation wallet ${short(d.org)}`} subtitle="One key. It can issue, stop every pass, and withdraw the gate float." />
          </Group>
        )}

        <Group title="Guarantees" footer="Each guarantee comes from ENSv2 or the OnShift contracts, not from this website. They hold even if this site is offline.">
          <Row icon={Clock3} tint="blue" title="Passes end on their own" subtitle="Liveness is read from the ENS registry's state at every use" />
          <Row icon={Lock} tint="indigo" title="Payouts can't be redirected" subtitle="Only the issuer can write a pass's payout record" />
          <Row icon={KeyRound} tint="purple" title="Passes can't be sold or lent" subtitle="Registered with zero roles — nothing to transfer or delegate" />
          <Row icon={Layers} tint="teal" title="Every pass is isolated" subtitle="Its own resolver, so a reused name never inherits old permissions" />
          <Row icon={RotateCcw} tint="orange" title="No silent revival" subtitle="Issuers can't renew, and the gate refuses a renewed pass" />
          <Row icon={Wallet} tint="green" title="Losses are bounded" subtitle={`Per-pass limits, daily lead budgets, and a gate float of $${Number(s.gateFloat) / 1e6}`} />
        </Group>
        {s.incident && <p className="footnote">Incident since {clock(s.blockTs)}.</p>}
      </div>

      {sheet && (
        <Sheet onClose={() => setSheet(false)}>
          <div className="sheet-icon" style={{ background: "var(--red-tint)", color: "var(--red)" }}>
            <AlertOctagon size={28} />
          </div>
          <div className="sheet-title">Stop all {plural(live, "pass")}?</div>
          <p className="secondary small" style={{ margin: "6px 0 18px" }}>
            Every staff member and agent loses authority immediately. Their passes never come back — you'll issue new ones after
            restoring.
          </p>
          <div className="stack-sm">
            <Field label="Reason (shown publicly)">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Field label={`Type ${d.orgName} to confirm`}>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 22 }}>
            <Button onClick={() => setSheet(false)}>Cancel</Button>
            <Button variant="destructive" disabled={typed.trim() !== d.orgName || !reason} onClick={breakGlass}>
              Stop All Passes
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
