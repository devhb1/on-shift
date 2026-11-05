import { useState } from "react";
import { AlertOctagon, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Card, Field, Modal, Pill } from "../components/ui";
import { RoleGate } from "../components/RoleGate";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { deployment } from "../lib/config";
import { short } from "../lib/format";
import { incidentSwitchAbi } from "../generated/abis";

export function Incident() {
  const { snapshot } = useOnShift();
  const { active, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const [reason, setReason] = useState("Fake support agents reported in community chat");
  const [confirming, setConfirming] = useState(false);
  const live = s.passes.filter((p) => p.state === "live").length;
  const isOrg = active.kind === "org";

  const breakGlass = async () => {
    setConfirming(false);
    await run(
      "break",
      () => send(active.privateKey, { address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "breakGlass", args: [reason] }),
      "Break-glass done",
      "Every pass stopped in one transaction. Verifiers now show incident mode.",
    );
  };

  const restore = () =>
    run(
      "restore",
      () => send(active.privateKey, { address: d.incidentSwitch, abi: incidentSwitchAbi, functionName: "restore" }),
      "Namespace restored",
      "A fresh registry now serves ops. Old passes stay dead - issue new ones.",
    );

  return (
    <>
      <RoleGate kinds={["org"]} what="Break glass">{null}</RoleGate>
      <div className="grid grid-main">
        <Card title="Namespace status" icon={s.incident ? ShieldAlert : ShieldCheck}>
          <div className="stack" style={{ gap: 18 }}>
            <div className="well row between">
              <div>
                <div className="cell-name">ops.{d.orgName}</div>
                <div className="cell-sub">{s.incident ? `Stopped: ${s.incidentReason}` : `${live} pass${live === 1 ? "" : "es"} on shift`}</div>
              </div>
              {s.incident ? <Pill tone="red">Incident</Pill> : <Pill tone="green">Operating</Pill>}
            </div>

            {!s.incident ? (
              <>
                <Field label="Reason (published on the org's ENS record)">
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
                <Button variant="danger-solid" size="lg" icon={AlertOctagon} disabled={!isOrg || !reason} loading={busy === "break"} onClick={() => setConfirming(true)}>
                  Break glass - stop every pass
                </Button>
              </>
            ) : (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  Restoring does not bring old passes back. It points ops at a brand-new registry, so everything issued before the
                  incident stays dead and new passes must be issued deliberately.
                </p>
                <Button variant="primary" size="lg" icon={RotateCcw} disabled={!isOrg} loading={busy === "restore"} onClick={restore}>
                  Restore with a fresh namespace
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card title="What break glass does" icon={ShieldAlert}>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 10 }}>
            <li>The org multisig re-points <b>ops.{d.orgName}</b> to an empty registry - one transaction.</li>
            <li>The payment gate follows the live pointer on every call, so every pass fails at once, humans and AI agents alike.</li>
            <li>The org's ENS record publishes <b>ops.status = incident</b> and the reason, so public verifiers warn customers.</li>
            <li>The switch contract can only write those two records - it holds no wider resolver role.</li>
          </ol>
          <details className="tech" style={{ marginTop: 16 }}>
            <summary>Technical details</summary>
            <dl className="kv small">
              <dt>Live ops registry</dt>
              <dd className="mono">{short(s.currentOps)}</dd>
              <dt>Empty registry</dt>
              <dd className="mono">{short(d.emptyRegistry)}</dd>
              <dt>Epoch</dt>
              <dd>{s.epoch}</dd>
            </dl>
          </details>
        </Card>
      </div>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <div className="stack">
            <div className="card-title"><AlertOctagon size={20} color="var(--red)" /> Stop every pass now?</div>
            <p className="muted" style={{ margin: 0 }}>
              {live} live pass{live === 1 ? "" : "es"} will stop working immediately. This cannot be undone for those passes -
              restoring creates a new namespace.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn btn-danger-solid" onClick={breakGlass}>Break glass</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
