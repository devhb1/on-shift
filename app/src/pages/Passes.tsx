import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Copy, ListChecks, Plus, Search, XOctagon } from "lucide-react";
import type { Hex } from "viem";
import { Button, Countdown, Empty, Group, KV, Meter, Row, Segmented, Sheet, StateBadge } from "../components/ui";
import { PassCard, verifyUrl } from "../components/PassCard";
import { passNode, useChainNow, useOnShift, type PassRow } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment, explorerAddress, explorerTx } from "../lib/config";
import { clock, sameAddress, short, timeAgo, usdc } from "../lib/format";
import { passIssuerAbi, permissionedResolverAbi } from "../generated/abis";
import { navigate } from "../App";
import { ACTIVITY_LOOK, passPreset, roleLook, whoIs } from "./shared";

type Filter = "live" | "ended" | "all";

export function Passes({ selected }: { selected: string | null }) {
  const { snapshot } = useOnShift();
  const { devices } = useSession();
  const now = useChainNow();
  const s = snapshot!;
  const d = deployment!;
  const staff = s.passes.filter((p) => !p.sandbox);
  const anyLive = staff.some((p) => p.state === "live");
  const [filter, setFilter] = useState<Filter>(anyLive ? "live" : "all");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      s.passes.filter((p) => {
        if (filter === "live" && (p.state !== "live" || p.sandbox)) return false;
        if (filter === "ended" && p.state === "live") return false;
        const q = query.trim().toLowerCase();
        return !q || p.label.includes(q) || whoIs(p.holder, s, devices, d.org).toLowerCase().includes(q);
      }),
    [s, filter, query, devices, d.org],
  );
  const current = selected !== null ? s.passes.find((p) => String(p.index) === selected) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="large-title">Passes</h1>
          <p className="page-sub">
            {staff.length} issued · {staff.filter((p) => p.state === "live").length} on shift
          </p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => navigate("new")} disabled={s.incident}>
          New Pass
        </Button>
      </div>

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="search" style={{ flex: "1 1 220px", maxWidth: 320 }}>
          <Search size={15} />
          <input className="input" placeholder="Search names or holders" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search passes" />
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "live", label: "On Shift" },
            { value: "ended", label: "Ended" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      <div className="split">
        <div className="group">
          {rows.length === 0 ? (
            <Empty icon={ListChecks} title={query ? "No matches" : filter === "live" ? "Nobody is on shift" : "No passes yet"}>
              {!query && <a href="#/new">Issue a pass</a>}
            </Empty>
          ) : (
            rows.map((p) => {
              const preset = passPreset(s, p);
              const look = roleLook(preset);
              return (
                <Row
                  key={p.index}
                  icon={look.icon}
                  tint={p.state === "live" ? look.tint : "soft"}
                  title={p.name}
                  subtitle={`${p.sandbox ? "Sandbox · " : ""}${whoIs(p.holder, s, devices, d.org)} · ${preset?.name ?? "Pass"}`}
                  trailing={p.state === "live" ? <Countdown expiry={p.expiry} /> : <StateBadge state={p.state} />}
                  selected={current?.index === p.index}
                  chevron
                  onClick={() => navigate("passes", { pass: String(p.index) })}
                />
              );
            })
          )}
        </div>
        {current ? (
          <Inspector pass={current} now={now} />
        ) : (
          <div className="group">
            <Empty icon={BadgeCheck} title="Select a pass">
              See its holder, limits, ENS records and history.
            </Empty>
          </div>
        )}
      </div>
    </div>
  );
}

function Inspector({ pass, now }: { pass: PassRow; now: number }) {
  const { snapshot } = useOnShift();
  const { devices, operator, operatorRole, run, busy, notify } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const preset = passPreset(s, pass);
  const [records, setRecords] = useState<{ org: string; role: string; status: string; payout: Hex; agent: string }>();
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const node = passNode(pass.label, pass.sandbox ? "demo" : "ops");
      const text = (key: string) => publicClient.readContract({ address: pass.resolver, abi: permissionedResolverAbi, functionName: "text", args: [node, key] });
      const [org, role, status, agent, payout] = await Promise.all([
        text("org"),
        text("role"),
        text("shift.status"),
        text("agent-context"),
        publicClient.readContract({ address: pass.resolver, abi: permissionedResolverAbi, functionName: "addr", args: [node, 60n] }),
      ]);
      if (!cancelled) setRecords({ org, role, status, agent, payout });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pass.label, pass.sandbox, pass.resolver, d.passIssuer, s.blockTs]);

  const canRevoke = pass.state === "live" && (operatorRole === "org" || (operator && sameAddress(operator.signer.address, pass.issuer)));
  const history = s.activity.filter((a) => a.label === pass.label && a.ts >= pass.issuedAt - 1 && a.ts <= Math.max(pass.expiry, pass.issuedAt) + 5);
  const actions = [preset?.actions & ACTION_REFUND ? "Refund" : "", preset?.actions & ACTION_CHECK_IN ? "Check in" : "", "Status"].filter(Boolean).join(", ");

  const revoke = async () => {
    setConfirm(false);
    if (!operator) return;
    await run(
      "revoke",
      () => send(operator.signer, { address: d.passIssuer, abi: passIssuerAbi, functionName: "revokeNow", args: [pass.label] }),
      "Pass revoked",
      `${pass.label} stopped working immediately.`,
    );
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PassCard pass={pass} preset={preset} small />
      <Group>
        <KV
          rows={[
            ["Status", <StateBadge state={pass.state} />],
            ...(pass.state === "live" ? ([["Time left", <Countdown expiry={pass.expiry} />]] as [string, React.ReactNode][]) : []),
            ["Holder", whoIs(pass.holder, s, devices, d.org)],
            ["Issued by", whoIs(pass.issuer, s, devices, d.org)],
            ["Issued", `${clock(pass.issuedAt)} · ${timeAgo(now - pass.issuedAt)}`],
            ["Ends", clock(pass.expiry)],
            ["Can do", actions],
          ]}
        />
        {pass.cap > 0n && (
          <div style={{ padding: "4px 16px 14px" }}>
            <div className="row spread small secondary" style={{ marginBottom: 6 }}>
              <span>Spent {usdc(pass.spent)}</span>
              <span>Limit {usdc(pass.cap)}</span>
            </div>
            <Meter value={pass.spent} max={pass.cap} />
          </div>
        )}
      </Group>

      <Group title="ENS Records" footer={pass.state === "live" ? "Only the issuer can write these, except shift.status." : "The registry no longer points at this resolver, so these records no longer resolve."}>
        <KV
          rows={[
            ["Organization", records?.org || "—"],
            ["Role", records?.role || "—"],
            ["Status note", records?.status || "—"],
            ["Payouts go to", records ? (sameAddress(`0x${records.payout.slice(2, 42)}`, d.treasury) ? "Org treasury" : short(records.payout)) : "—"],
            ...(records?.agent ? ([["Agent", records.agent]] as [string, string][]) : []),
          ]}
        />
      </Group>

      {history.length > 0 && (
        <Group title="History">
          {history.map((a) => (
            <Row
              key={a.key}
              icon={ACTIVITY_LOOK[a.kind].icon}
              tint={ACTIVITY_LOOK[a.kind].tint}
              title={a.title}
              subtitle={`${clock(a.ts)}`}
              trailing={explorerTx(a.txHash) ? <a href={explorerTx(a.txHash)} target="_blank" rel="noreferrer" className="small">Tx ↗</a> : undefined}
            />
          ))}
        </Group>
      )}

      <div className="row wrap">
        <Button
          icon={Copy}
          onClick={() => navigator.clipboard?.writeText(verifyUrl(pass.name)).then(() => notify({ tone: "info", title: "Verify link copied" }))}
        >
          Copy Link
        </Button>
        <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: pass.name })}>
          Public Check
        </Button>
        {explorerAddress(pass.resolver) && (
          <a className="btn" href={explorerAddress(pass.resolver)} target="_blank" rel="noreferrer">
            Resolver ↗
          </a>
        )}
        {canRevoke && (
          <Button variant="plain danger" icon={XOctagon} loading={busy === "revoke"} onClick={() => setConfirm(true)}>
            Revoke…
          </Button>
        )}
      </div>

      {confirm && (
        <Sheet onClose={() => setConfirm(false)}>
          <div className="sheet-icon" style={{ background: "var(--red-tint)", color: "var(--red)" }}>
            <XOctagon size={28} />
          </div>
          <div className="sheet-title">Revoke {pass.label}?</div>
          <p className="secondary" style={{ margin: "8px 0 20px" }}>
            The pass stops working immediately. Use this if a phone is lost or someone leaves early. It can't be undone — issue a
            new pass if needed.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={revoke}>
              Revoke Pass
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
