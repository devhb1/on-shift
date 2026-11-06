import { PlugZap } from "lucide-react";
import { Empty } from "../components/ui";
import { deployment, networkLabel, RPC_URLS } from "../lib/config";

export function Setup({ error }: { error?: string }) {
  return (
    <div className="page page-narrow">
      <div className="group">
        <Empty icon={PlugZap} title={deployment ? `Can't reach ${networkLabel}` : "OnShift isn't deployed on this network"}>
          {deployment ? (
            <>Couldn't read from {RPC_URLS[0]}. For the local demo, run <span className="mono">npm run dev</span>.</>
          ) : (
            <>From the repository root run <span className="mono">npm install && npm run dev</span>.</>
          )}
          {error && error !== "no-deployment" && <div className="footnote" style={{ marginTop: 10 }}>{error.slice(0, 200)}</div>}
        </Empty>
      </div>
    </div>
  );
}
