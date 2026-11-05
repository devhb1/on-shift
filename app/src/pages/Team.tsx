import { useEffect, useState } from "react";
import { formatEther, isAddress, type Address } from "viem";
import { Bot, Building2, Smartphone, UserPlus, UserRound, Users, Wallet, Layers } from "lucide-react";
import { Button, Card, Field, Pill } from "../components/ui";
import { RoleGate } from "../components/RoleGate";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment } from "../lib/config";
import { humanDuration, sameAddress, short, usdc } from "../lib/format";
import { mockUSDCAbi, passIssuerAbi } from "../generated/abis";

const ICON = { org: Building2, lead: UserRound, agent: Bot, staff: Smartphone };

export function Team() {
  const { snapshot } = useOnShift();
  const { active, identities, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const [leadAddress, setLeadAddress] = useState("");
  const [budget, setBudget] = useState("10");
  const [balances, setBalances] = useState<Record<string, { eth: bigint; usdc: bigint }>>({});

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      identities.map(async (i) => {
        const [eth, u] = await Promise.all([
          publicClient.getBalance({ address: i.address }),
          publicClient.readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [i.address] }),
        ]);
        return [i.address, { eth, usdc: u }] as const;
      }),
    ).then((list) => !cancelled && setBalances(Object.fromEntries(list)));
    return () => {
      cancelled = true;
    };
  }, [identities, s.blockTs, d.usdc]);

  const name = (a: Address) => identities.find((i) => sameAddress(i.address, a))?.label ?? short(a);

  const saveLead = (address: Address, dailyBudget: number, activeFlag: boolean) =>
    run(
      `lead-${address}`,
      () => send(active.privateKey, { address: d.passIssuer, abi: passIssuerAbi, functionName: "setLead", args: [address, dailyBudget, activeFlag] }),
      activeFlag ? "Shift lead saved" : "Shift lead disabled",
    );

  return (
    <>
      <div className="grid grid-2">
        <Card title="Shift leads" icon={Users}>
          <div className="table-wrap">
            <table style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Today</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.leads.map((l) => (
                  <tr key={l.address}>
                    <td>
                      <div className="cell-name">{name(l.address)}</div>
                      <div className="cell-sub mono">{short(l.address)}</div>
                    </td>
                    <td>{l.remaining} of {l.dailyBudget} left</td>
                    <td>{l.active ? <Pill tone="green">Active</Pill> : <Pill tone="grey">Disabled</Pill>}</td>
                    <td style={{ textAlign: "right" }}>
                      {active.kind === "org" && (
                        <button className="btn btn-sm" disabled={busy === `lead-${l.address}`} onClick={() => saveLead(l.address, l.dailyBudget, !l.active)}>
                          {l.active ? "Disable" : "Enable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Each lead has a daily issuance budget, so a stolen lead key can do at most budget × cap damage.
          </p>
        </Card>

        <Card title="Add or update a lead" icon={UserPlus}>
          <RoleGate kinds={["org"]} what="Managing shift leads">
            <div className="stack">
              <Field label="Lead wallet address">
                <input className="input mono" placeholder="0x…" value={leadAddress} onChange={(e) => setLeadAddress(e.target.value.trim())} />
              </Field>
              <Field label="Passes per day">
                <input className="input" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Button
                variant="primary"
                icon={UserPlus}
                disabled={!isAddress(leadAddress) || !Number(budget)}
                loading={busy === `lead-${leadAddress}`}
                onClick={() => saveLead(leadAddress as Address, Number(budget), true)}
              >
                Save lead
              </Button>
            </div>
          </RoleGate>
        </Card>
      </div>

      <Card title="Role presets" icon={Layers}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Max cap</th>
                <th>Max shift</th>
                <th>Can do</th>
              </tr>
            </thead>
            <tbody>
              {s.presets.map((p) => (
                <tr key={p.id}>
                  <td className="cell-name">{p.agent ? <Bot size={14} /> : null} {p.name}</td>
                  <td>{p.maxCap > 0n ? usdc(p.maxCap) : "-"}</td>
                  <td>{humanDuration(p.maxDuration)}</td>
                  <td>
                    <div className="row row-wrap">
                      {(p.actions & ACTION_REFUND) !== 0 && <Pill tone="blue">Refund</Pill>}
                      {(p.actions & ACTION_CHECK_IN) !== 0 && <Pill tone="blue">Check in</Pill>}
                      <Pill tone="grey">Status</Pill>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Wallets in this demo" icon={Wallet}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Identity</th>
                <th>Address</th>
                <th>ETH</th>
                <th>USDC</th>
              </tr>
            </thead>
            <tbody>
              {identities.map((i) => {
                const Icon = ICON[i.kind];
                const b = balances[i.address];
                return (
                  <tr key={i.id}>
                    <td>
                      <div className="row">
                        <div className="avatar"><Icon size={15} /></div>
                        <div>
                          <div className="cell-name">{i.label}</div>
                          <div className="cell-sub">{i.subtitle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono">{short(i.address)}</td>
                    <td>{b ? Number(formatEther(b.eth)).toFixed(3) : "…"}</td>
                    <td>{b ? usdc(b.usdc) : "…"}</td>
                  </tr>
                );
              })}
              <tr>
                <td>
                  <div className="row">
                    <div className="avatar"><Wallet size={15} /></div>
                    <div>
                      <div className="cell-name">ShiftGate float</div>
                      <div className="cell-sub">Maximum blast radius</div>
                    </div>
                  </div>
                </td>
                <td className="mono">{short(d.shiftGate)}</td>
                <td>-</td>
                <td>{usdc(s.gateFloat)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
