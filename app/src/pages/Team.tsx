import { useState } from "react";
import { isAddress, type Address } from "viem";
import { UserPlus, UserRound } from "lucide-react";
import { Button, Field, Group, KV, Row, Sheet, Switch } from "../components/ui";
import { Gate } from "../components/Gate";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment } from "../lib/config";
import { humanDuration, sameAddress, short, usdc } from "../lib/format";
import { passIssuerAbi } from "../generated/abis";
import { roleLook } from "./shared";

export function Team() {
  const { snapshot } = useOnShift();
  const { operator, operatorRole, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [budget, setBudget] = useState("10");
  const isOrg = operatorRole === "org";

  const saveLead = (lead: Address, dailyBudget: number, active: boolean) =>
    operator
      ? run(
          `lead-${lead}`,
          () => send(operator.signer, { address: d.passIssuer, abi: passIssuerAbi, functionName: "setLead", args: [lead, dailyBudget, active] }),
          active ? "Lead saved" : "Lead turned off",
        )
      : Promise.resolve(false);

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="large-title">Team & Roles</h1>
          <p className="page-sub">Who can issue passes, and what each kind of pass may do.</p>
        </div>
        {isOrg && (
          <Button variant="primary" icon={UserPlus} onClick={() => setAdding(true)}>
            Add Lead
          </Button>
        )}
      </div>

      <div className="stack">
        {!isOrg && <Gate need={["org"]} what="Only the org can add or remove shift leads." />}

        <Group title="Shift Leads" footer="Each lead has a daily issuing budget, so a stolen lead key can do at most budget × limit damage — and the org can turn it off here.">
          {s.leads.map((l) => (
            <Row
              key={l.address}
              icon={UserRound}
              tint={l.active ? "blue" : "soft"}
              title={sameAddress(l.address, d.org) ? "Org admin" : `Lead ${short(l.address)}`}
              subtitle={l.active ? `${l.remaining} of ${l.dailyBudget} passes left today` : "Turned off"}
              trailing={<Switch on={l.active} disabled={!isOrg || busy === `lead-${l.address}`} onChange={(v) => saveLead(l.address, l.dailyBudget, v)} label={`Lead ${l.address} active`} />}
            />
          ))}
        </Group>

        <Group title="Roles" footer="Roles are set by the org. The limit and allowed actions are written into each pass's ENS record and enforced by the payment gate.">
          {s.presets.map((p) => {
            const look = roleLook(p);
            const can = [p.actions & ACTION_REFUND ? "Refunds" : "", p.actions & ACTION_CHECK_IN ? "Check-in" : "", "Status"].filter(Boolean).join(", ");
            return (
              <Row
                key={p.id}
                icon={look.icon}
                tint={look.tint}
                title={p.name}
                subtitle={`${can} · up to ${humanDuration(p.maxDuration)}`}
                trailing={p.maxCap > 0n ? usdc(p.maxCap) : "No spending"}
              />
            );
          })}
        </Group>

        <Group title="Policy" footer="These limits are constants in the PassIssuer contract.">
          <KV
            rows={[
              ["Longest pass", "12 hours"],
              ["Shortest pass", "30 seconds"],
              ["Renewals", "Never — a new shift is a new pass"],
              ["Gas allowance", "At most 0.05 ETH per pass"],
              ["Gate float", `${usdc(s.gateFloat)} — the most passes can ever pay out`],
            ]}
          />
        </Group>
      </div>

      {adding && (
        <Sheet onClose={() => setAdding(false)}>
          <div className="sheet-icon" style={{ background: "var(--blue-tint)", color: "var(--blue)" }}>
            <UserPlus size={28} />
          </div>
          <div className="sheet-title">Add a Shift Lead</div>
          <p className="secondary small" style={{ margin: "6px 0 18px" }}>
            Leads can issue and revoke passes within their daily budget. Saving an existing wallet replaces its daily budget.
          </p>
          <div className="stack-sm">
            <Field label="Wallet address">
              <input className="input mono" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value.trim())} autoFocus />
            </Field>
            <Field label="Passes per day">
              <input className="input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 22 }}>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!isAddress(address) || !Number(budget)}
              loading={busy === `lead-${address}`}
              onClick={async () => (await saveLead(address as Address, Number(budget), true)) && setAdding(false)}
            >
              Add Lead
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
