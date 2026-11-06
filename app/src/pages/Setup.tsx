import { PlugZap } from "lucide-react";
import { Empty } from "../components/ui";
import { deployment, isLocal, networkLabel, RPC_URLS } from "../lib/config";

export function Setup({ error }: { error?: string }) {
  return (
    <div className="page page-narrow">
      <div className="group">
        <Empty icon={PlugZap} title={deployment ? `Can't reach ${networkLabel}` : "OnShift isn't deployed on this network"}>
          {deployment ? (
            isLocal ? (
              <>Couldn't read from {RPC_URLS[0]}. For the local demo, run <span className="mono">npm run dev</span>.</>
            ) : (
              <>Couldn't read {networkLabel}. Check your connection and reload. If this keeps happening, the public RPC is rate-limiting this site.</>
            )
          ) : (
            <>This build has no OnShift deployment for the selected network.</>
          )}
          {error && error !== "no-deployment" && <div className="footnote" style={{ marginTop: 10 }}>{error.slice(0, 200)}</div>}
        </Empty>
      </div>
    </div>
  );
}
