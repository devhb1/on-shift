import { Activity, AlertOctagon, CircleDollarSign, PlusCircle, RotateCcw, Ticket, UserRound, XOctagon } from "lucide-react";
import { Card, Empty } from "../components/ui";
import { useChainNow, useOnShift, type ActivityItem } from "../lib/onshift";
import { timeAgo } from "../lib/format";

const KIND: Record<ActivityItem["kind"], { icon: typeof Activity; color: string }> = {
  issued: { icon: PlusCircle, color: "var(--accent)" },
  revoked: { icon: XOctagon, color: "var(--red)" },
  refund: { icon: CircleDollarSign, color: "var(--amber)" },
  checkin: { icon: Ticket, color: "var(--green)" },
  incident: { icon: AlertOctagon, color: "var(--red)" },
  restored: { icon: RotateCcw, color: "var(--green)" },
  lead: { icon: UserRound, color: "var(--muted)" },
};

export function ActivityFeed({ limit }: { limit?: number }) {
  const { snapshot } = useOnShift();
  const now = useChainNow();
  const items = (snapshot?.activity ?? []).slice(0, limit);
  if (items.length === 0) return <Empty icon={Activity} title="Nothing yet" />;
  return (
    <div className="feed">
      {items.map((a) => {
        const k = KIND[a.kind];
        return (
          <div key={a.key} className="feed-item">
            <div className="feed-dot" style={{ color: k.color }}>
              <k.icon size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.detail}</div>
            </div>
            <div className="small muted" style={{ whiteSpace: "nowrap" }}>{timeAgo(now - a.ts)}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ActivityLog() {
  return (
    <Card title="Everything that happened" icon={Activity}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Read from contract events on chain. Every issuance, revocation, refund and incident is public and permanent.
      </p>
      <ActivityFeed />
    </Card>
  );
}
