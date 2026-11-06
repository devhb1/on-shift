import type { ReactNode } from "react";
import { Lock, Wallet } from "lucide-react";
import { useSession, type OperatorRole } from "../lib/session";
import { isLocal } from "../lib/config";
import { Button } from "./ui";

/** Inline notice when the signed-in operator can't do this. Explains why and offers the fix. */
export function Gate({ need, what, children }: { need: OperatorRole[]; what: string; children?: ReactNode }) {
  const { operator, operatorRole, operators, setOperator, connectWallet } = useSession();
  if (need.includes(operatorRole)) return <>{children}</>;
  const local = isLocal ? operators.find((o) => (need.includes("org") && o.id === "org") || (need.includes("lead") && o.id === "lead")) : undefined;
  return (
    <div className="status-strip">
      <span className="tile soft">
        <Lock size={15} />
      </span>
      <div style={{ flex: 1 }}>
        <div className="strip-title">{need.includes("lead") ? "Shift leads only" : "Org admin only"}</div>
        <div className="small secondary">
          {what} {!operator ? "Connect the wallet that holds this role." : "The signed-in wallet doesn't hold this role on chain."}
        </div>
      </div>
      {local ? (
        <Button onClick={() => setOperator(local.id)}>Use {local.label}</Button>
      ) : !operator ? (
        <Button variant="primary" icon={Wallet} onClick={() => connectWallet()}>
          Connect
        </Button>
      ) : null}
    </div>
  );
}
