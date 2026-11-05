import { useState } from "react";
import { BadgeCheck, ListChecks, XOctagon } from "lucide-react";
import { Card, Countdown, Empty, Progress, StatePill } from "../components/ui";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { deployment } from "../lib/config";
import { sameAddress, short, usdc } from "../lib/format";
import { passIssuerAbi } from "../generated/abis";
import { navigate } from "../App";

type Filter = "all" | "live" | "ended";

export function Passes() {
  const { snapshot } = useOnShift();
  const { active, identities, run, busy } = useSession();
  const [filter, setFilter] = useState<Filter>("all");
  const s = snapshot!;
  const d = deployment!;

  const rows = s.passes.filter((p) => (filter === "all" ? true : filter === "live" ? p.state === "live" : p.state !== "live"));
  const holderName = (a: string) => identities.find((i) => sameAddress(i.address, a))?.label ?? short(a);

  const revoke = (label: string) =>
    run(
      `revoke-${label}`,
      () => send(active.privateKey, { address: d.passIssuer, abi: passIssuerAbi, functionName: "revokeNow", args: [label] }),
      "Pass revoked",
      `${label}.ops.${d.orgName} stopped working immediately.`,
    );

  return (
    <Card
      title="All passes"
      icon={ListChecks}
      action={
        <div className="row">
          {(["all", "live", "ended"] as Filter[]).map((f) => (
            <button key={f} className={`chip-btn ${filter === f ? "selected" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "live" ? "On shift" : "Ended"}
            </button>
          ))}
        </div>
      }
    >
      {rows.length === 0 ? (
        <Empty icon={ListChecks} title="No passes here yet">Issue one from the Issue pass page.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pass</th>
                <th>Holder</th>
                <th>Status</th>
                <th>Time left</th>
                <th style={{ minWidth: 150 }}>Spent / cap</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const canRevoke = p.state === "live" && (active.kind === "org" || sameAddress(active.address, p.issuer));
                return (
                  <tr key={p.index}>
                    <td>
                      <div className="cell-name">{p.name}</div>
                      <div className="cell-sub">{s.presets[p.presetId]?.name}{p.shiftStatus ? ` · ${p.shiftStatus}` : ""}</div>
                    </td>
                    <td>
                      <div>{holderName(p.holder)}</div>
                      <div className="cell-sub">issued by {holderName(p.issuer)}</div>
                    </td>
                    <td><StatePill state={p.state} /></td>
                    <td>{p.state === "live" ? <Countdown expiry={p.expiry} /> : <span className="muted">-</span>}</td>
                    <td>
                      {p.cap > 0n ? (
                        <>
                          <div className="small" style={{ marginBottom: 6 }}>{usdc(p.spent)} / {usdc(p.cap)}</div>
                          <Progress value={p.spent} max={p.cap} />
                        </>
                      ) : (
                        <span className="muted small">No spending</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button className="btn btn-sm" onClick={() => navigate("verify", { name: p.name })}>
                          <BadgeCheck size={14} /> Verify
                        </button>
                        {canRevoke && (
                          <button className="btn btn-sm btn-danger" disabled={busy === `revoke-${p.label}`} onClick={() => revoke(p.label)}>
                            <XOctagon size={14} /> Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
