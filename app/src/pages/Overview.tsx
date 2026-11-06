import { AlertTriangle, ChevronRight, Clock3, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button, Countdown, Empty, Group, Meter, Row, Tile } from "../components/ui";
import { useChainNow, useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { deployment } from "../lib/config";
import { clock, plural, sameAddress, timeAgo, usdc } from "../lib/format";
import { navigate } from "../App";
import { ACTIVITY_LOOK, roleLook, whoIs } from "./shared";

export function Overview() {
  const { snapshot } = useOnShift();
  const { devices, operator } = useSession();
  const now = useChainNow();
  const s = snapshot!;
  const d = deployment!;

  const live = s.passes.filter((p) => p.state === "live").sort((a, b) => a.expiry - b.expiry);
  const endingSoon = live.filter((p) => p.expiry - now <= 15 * 60);
  const nearCap = live.filter((p) => p.cap > 0n && p.spent * 10n >= p.cap * 8n);
  const startOfDay = new Date(new Date(now * 1000).toDateString()).getTime() / 1000;
  const today = s.passes.filter((p) => p.issuedAt >= startOfDay);
  const spentToday = today.reduce((sum, p) => sum + p.spent, 0n);
  const lead = s.leads.find((l) => operator && sameAddress(l.address, operator.signer.address));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="large-title">Overview</h1>
          <p className="page-sub">
            {d.orgName} · {live.length ? `${plural(live.length, "pass")} on shift` : "nobody on shift"}
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate("new")} disabled={s.incident}>
          New Pass
        </Button>
      </div>

      <div className="stack">
        {s.incident ? (
          <button className="status-strip alert" style={{ border: 0, textAlign: "left", cursor: "pointer" }} onClick={() => navigate("security")}>
            <Tile icon={ShieldAlert} tint="red" />
            <div style={{ flex: 1 }}>
              <div className="strip-title">Incident mode — every pass is stopped</div>
              <div className="small secondary">{s.incidentReason || "No reason given"}. Restore from Security when it's safe.</div>
            </div>
            <ChevronRight size={16} className="chev" />
          </button>
        ) : (
          <div className="status-strip">
            <Tile icon={ShieldCheck} tint="green" />
            <div>
              <div className="strip-title">Operating normally</div>
              <div className="small secondary">Every pass ends on its own. There is nothing to remember to revoke.</div>
            </div>
          </div>
        )}

        <div className="widgets">
          <div className="widget">
            <div className="widget-label" style={{ color: "var(--green)" }}>On Shift</div>
            <div className="widget-value">{live.length}</div>
            <div className="widget-caption">people and agents right now</div>
          </div>
          <div className="widget">
            <div className="widget-label" style={{ color: "var(--orange)" }}>Ending Soon</div>
            <div className="widget-value">{endingSoon.length}</div>
            <div className="widget-caption">within 15 minutes</div>
          </div>
          <div className="widget">
            <div className="widget-label" style={{ color: "var(--blue)" }}>Refunded Today</div>
            <div className="widget-value">{usdc(spentToday)}</div>
            <div className="widget-caption">across {plural(today.length, "pass")} issued today</div>
          </div>
          <div className="widget">
            <div className="widget-label" style={{ color: "var(--purple-solid)" }}>{lead ? "Your Budget" : "Gate Float"}</div>
            <div className="widget-value">{lead ? `${lead.remaining}` : usdc(s.gateFloat)}</div>
            <div className="widget-caption">{lead ? `of ${lead.dailyBudget} passes left today` : "the most passes can ever pay out"}</div>
          </div>
        </div>

        <div className="cols-2" style={{ alignItems: "start" }}>
          <Group title="On Shift" action={live.length > 0 ? <a href="#/passes">See All</a> : undefined}>
            {live.length === 0 ? (
              <Empty icon={Clock3} title="Nobody holds authority right now">
                That's the safe default. Issue a pass when a shift starts.
              </Empty>
            ) : (
              live.slice(0, 6).map((p) => {
                const look = roleLook(s.presets[p.presetId]);
                return (
                  <Row
                    key={p.index}
                    icon={look.icon}
                    tint={look.tint}
                    title={p.label}
                    subtitle={`${whoIs(p.holder, s, devices, d.org)} · ${p.shiftStatus || s.presets[p.presetId]?.name}`}
                    trailing={
                      <div style={{ minWidth: 74 }}>
                        <Countdown expiry={p.expiry} />
                        {p.cap > 0n && (
                          <div style={{ marginTop: 5 }}>
                            <Meter value={p.spent} max={p.cap} />
                          </div>
                        )}
                      </div>
                    }
                    chevron
                    onClick={() => navigate("passes", { pass: String(p.index) })}
                  />
                );
              })
            )}
          </Group>

          <div className="stack">
            {(endingSoon.length > 0 || nearCap.length > 0) && (
              <Group title="Needs Attention">
                {nearCap.map((p) => (
                  <Row
                    key={`cap-${p.index}`}
                    icon={AlertTriangle}
                    tint="orange"
                    title={`${p.label} is near its limit`}
                    subtitle={`${usdc(p.spent)} of ${usdc(p.cap)} used`}
                    chevron
                    onClick={() => navigate("passes", { pass: String(p.index) })}
                  />
                ))}
                {endingSoon.map((p) => (
                  <Row
                    key={`end-${p.index}`}
                    icon={Clock3}
                    tint="orange"
                    title={`${p.label} ends at ${clock(p.expiry)}`}
                    subtitle="Issue a new pass if the shift runs over — passes can't be extended"
                    chevron
                    onClick={() => navigate("passes", { pass: String(p.index) })}
                  />
                ))}
              </Group>
            )}

            <Group title="Recent Activity" action={<a href="#/activity">See All</a>}>
              {s.activity.filter((a) => a.kind !== "lead").length === 0 ? (
                <Empty icon={Clock3} title="Nothing yet" />
              ) : (
                s.activity
                  .filter((a) => a.kind !== "lead")
                  .slice(0, 5)
                  .map((a) => (
                    <Row key={a.key} icon={ACTIVITY_LOOK[a.kind].icon} tint={ACTIVITY_LOOK[a.kind].tint} title={a.title} subtitle={a.detail} trailing={<span className="small">{timeAgo(now - a.ts)}</span>} />
                  ))
              )}
            </Group>
          </div>
        </div>
      </div>
    </div>
  );
}
