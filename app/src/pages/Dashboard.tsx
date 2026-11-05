import { AlertOctagon, BadgeCheck, Bot, CircleDollarSign, Clock3, PlusCircle, Smartphone, Ticket, Users } from "lucide-react";
import { Card, Countdown, Empty, Progress, Stat } from "../components/ui";
import { ActivityFeed } from "./ActivityLog";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { usdc } from "../lib/format";
import { navigate } from "../App";

export function Dashboard() {
  const { snapshot } = useOnShift();
  const { active } = useSession();
  const s = snapshot!;
  const live = s.passes.filter((p) => p.state === "live");
  const paidOut = s.passes.reduce((sum, p) => sum + p.spent, 0n);
  const myLead = s.leads.find((l) => l.address.toLowerCase() === active.address.toLowerCase());

  return (
    <>
      {s.incident && (
        <div className="banner red">
          <AlertOctagon size={22} />
          <div style={{ flex: 1 }}>
            <b>Incident mode.</b> Every pass is stopped. Reason: {s.incidentReason || "not given"}
          </div>
          <button className="btn btn-sm" onClick={() => navigate("incident")}>Open break glass</button>
        </div>
      )}

      <div className="grid grid-4">
        <Stat icon={BadgeCheck} value={live.length} label="Passes on shift now" tone="green" />
        <Stat icon={Ticket} value={s.passes.length} label="Passes issued in total" />
        <Stat icon={CircleDollarSign} value={usdc(paidOut)} label="Refunded through the gate" tone="amber" />
        <Stat
          icon={Users}
          value={myLead ? `${myLead.remaining} / ${myLead.dailyBudget}` : usdc(s.gateFloat)}
          label={myLead ? "Your issuance budget today" : "Gate float (max blast radius)"}
        />
      </div>

      <div className="grid grid-main">
        <Card
          title="On shift right now"
          icon={Clock3}
          action={<button className="btn btn-sm btn-primary" onClick={() => navigate("issue")}><PlusCircle size={15} /> Issue pass</button>}
        >
          {live.length === 0 ? (
            <Empty icon={Clock3} title="Nobody holds authority right now">
              That is the default. Issue a pass when someone starts a shift - it ends on its own.
            </Empty>
          ) : (
            <div className="stack">
              {live.map((p) => {
                const preset = s.presets[p.presetId];
                return (
                  <div key={p.index} className="well">
                    <div className="row between row-wrap">
                      <div className="row">
                        <div className="avatar">{preset?.agent ? <Bot size={16} /> : <Smartphone size={16} />}</div>
                        <div>
                          <div className="cell-name">{p.name}</div>
                          <div className="cell-sub">{preset?.name} · {p.shiftStatus || "No status"}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <Countdown expiry={p.expiry} className="cell-name" />
                        <div className="cell-sub">left</div>
                      </div>
                    </div>
                    {p.cap > 0n && (
                      <div style={{ marginTop: 12 }}>
                        <div className="row between small muted" style={{ marginBottom: 6 }}>
                          <span>Spent {usdc(p.spent)}</span>
                          <span>Cap {usdc(p.cap)}</span>
                        </div>
                        <Progress value={p.spent} max={p.cap} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="Recent activity" icon={Clock3} action={<button className="btn btn-sm" onClick={() => navigate("activity")}>View all</button>}>
          <ActivityFeed limit={7} />
        </Card>
      </div>

      <div className="grid grid-3">
        <Card title="1 · Issue" icon={PlusCircle}>
          <p className="muted small" style={{ margin: 0 }}>
            A shift lead gives a staff phone or AI agent a name like <b>shift-0412.ops.acme.eth</b>, with a cap and an end time.
          </p>
        </Card>
        <Card title="2 · Use" icon={Smartphone}>
          <p className="muted small" style={{ margin: 0 }}>
            The holder can refund or check in up to the cap. They can never change the payout address or hand the pass on.
          </p>
        </Card>
        <Card title="3 · Expire" icon={Clock3}>
          <p className="muted small" style={{ margin: 0 }}>
            When the shift ends, the pass stops working by itself. Nobody has to remember to revoke it.
          </p>
        </Card>
      </div>
    </>
  );
}
