import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useSession } from "../lib/session";
import type { Identity } from "../lib/identities";

/** Shows children only to the right identity, with a one-click switch otherwise. */
export function RoleGate({
  kinds,
  children,
  what,
}: {
  kinds: Identity["kind"][];
  children: ReactNode;
  what: string;
}) {
  const { active, identities, setActive } = useSession();
  if (kinds.includes(active.kind)) return <>{children}</>;
  const target = identities.find((i) => kinds.includes(i.kind));
  return (
    <div className="banner blue">
      <Lock size={18} />
      <div style={{ flex: 1 }}>
        {what} needs the <b>{target?.label ?? kinds.join(" / ")}</b> identity. You are acting as <b>{active.label}</b>.
      </div>
      {target && (
        <button className="btn btn-sm" onClick={() => setActive(target.id)}>
          Switch to {target.label}
        </button>
      )}
    </div>
  );
}
