import { PlugZap } from "lucide-react";
import { Card } from "../components/ui";
import { deployment, RPC_URL } from "../lib/config";

export function Setup({ error }: { error?: string }) {
  return (
    <Card title={deployment ? "Can't reach the chain" : "OnShift is not deployed yet"} icon={PlugZap}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {deployment
            ? `The app could not read from ${RPC_URL}. Start the local chain and deploy the contracts:`
            : "No deployment was found for this chain. From the repository root, run:"}
        </p>
        <div className="well mono">npm install &amp;&amp; npm run dev</div>
        <p className="small muted" style={{ margin: 0 }}>
          This starts Anvil with one-second blocks, deploys OnShift with the local ENSv2 layer, exports addresses to the app
          and opens it on port 5173.
        </p>
        {error && error !== "no-deployment" && <div className="small mono muted">{error.slice(0, 240)}</div>}
      </div>
    </Card>
  );
}
