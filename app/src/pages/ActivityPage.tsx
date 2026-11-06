import { useState } from "react";
import { Activity } from "lucide-react";
import { Empty, Group, Row, Segmented } from "../components/ui";
import { useChainNow, useOnShift, type ActivityItem } from "../lib/onshift";
import { clock, dayLabel } from "../lib/format";
import { explorerTx } from "../lib/config";
import { ACTIVITY_LOOK } from "./shared";

type Filter = "all" | "passes" | "payments" | "security";
const MATCH: Record<Filter, ActivityItem["kind"][]> = {
  all: ["issued", "revoked", "paid", "refund", "checkin", "incident", "restored", "lead"],
  passes: ["issued", "revoked", "lead"],
  payments: ["paid", "refund", "checkin"],
  security: ["incident", "restored", "revoked"],
};

export function ActivityPage() {
  const { snapshot } = useOnShift();
  const now = useChainNow();
  const [filter, setFilter] = useState<Filter>("all");
  const items = (snapshot?.activity ?? []).filter((a) => MATCH[filter].includes(a.kind));
  const days = new Map<string, ActivityItem[]>();
  for (const a of items) {
    const k = dayLabel(a.ts, now);
    days.set(k, [...(days.get(k) ?? []), a]);
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="large-title">Activity</h1>
          <p className="page-sub">Read from contract events. Every issuance, refund and incident is public and permanent.</p>
        </div>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "passes", label: "Passes" },
            { value: "payments", label: "Payments" },
            { value: "security", label: "Security" },
          ]}
        />
      </div>
      <div className="stack">
        {items.length === 0 ? (
          <div className="group">
            <Empty icon={Activity} title="Nothing here yet" />
          </div>
        ) : (
          [...days.entries()].map(([day, list]) => (
            <Group key={day} title={day}>
              {list.map((a) => (
                <Row
                  key={a.key}
                  icon={ACTIVITY_LOOK[a.kind].icon}
                  tint={ACTIVITY_LOOK[a.kind].tint}
                  title={a.title}
                  subtitle={a.detail}
                  trailing={
                    explorerTx(a.txHash) ? (
                      <a href={explorerTx(a.txHash)} target="_blank" rel="noreferrer" className="small">
                        {clock(a.ts)} ↗
                      </a>
                    ) : (
                      <span className="small">{clock(a.ts)}</span>
                    )
                  }
                />
              ))}
            </Group>
          ))
        )}
      </div>
    </div>
  );
}
