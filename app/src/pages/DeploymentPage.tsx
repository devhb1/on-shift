import { Globe, Server } from "lucide-react";
import { Group, KV, Row, Segmented } from "../components/ui";
import { useOnShift } from "../lib/onshift";
import { availableNetworks, CHAIN_ID, deployment, ensAppUrl, explorerAddress, networkLabel, switchNetwork } from "../lib/config";
import { short } from "../lib/format";

function Addr({ a }: { a: string }) {
  const href = explorerAddress(a);
  return href ? (
    <a className="mono" href={href} target="_blank" rel="noreferrer">
      {short(a)} ↗
    </a>
  ) : (
    <span className="mono">{short(a)}</span>
  );
}

export function DeploymentPage() {
  const { snapshot } = useOnShift();
  const d = deployment!;
  const ens = ensAppUrl(d.orgName);
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1 className="large-title">Deployment</h1>
          <p className="page-sub">Where OnShift runs and which contracts back it. Nothing here is hard-coded in the app.</p>
        </div>
        {availableNetworks.length > 1 && (
          <Segmented
            value={String(CHAIN_ID)}
            onChange={(v) => switchNetwork(Number(v))}
            options={availableNetworks.map((n) => ({ value: String(n.chainId), label: n.network === "local" ? "Local" : n.network[0].toUpperCase() + n.network.slice(1) }))}
          />
        )}
      </div>
      <div className="stack">
        <Group>
          <Row icon={Globe} tint="blue" title={d.orgName} subtitle={`${networkLabel} · chain ${d.chainId}`} trailing={ens ? <a href={ens} target="_blank" rel="noreferrer">ENS App ↗</a> : undefined} />
          <Row icon={Server} tint="graphite" title={d.network === "local" ? "Local ENSv2 layer (ABI-compatible)" : "ENSv2 (ensdomains/contracts-v2)"} subtitle={`Passes live under ops.${d.orgName}`} />
        </Group>

        <Group title="OnShift contracts">
          <KV
            rows={[
              ["PassIssuer", <Addr a={d.passIssuer} />],
              ["ShiftGate", <Addr a={d.shiftGate} />],
              ["IncidentSwitch", <Addr a={d.incidentSwitch} />],
            ]}
          />
        </Group>

        <Group title={`ENS for ${d.orgName}`}>
          <KV
            rows={[
              [`${d.orgName} registry`, <Addr a={d.parentRegistry} />],
              [`${d.orgName} resolver`, <Addr a={d.parentResolver} />],
              ["ops registry (live)", <Addr a={snapshot?.currentOps ?? d.opsRegistry} />],
              ["Break-glass registry", <Addr a={d.emptyRegistry} />],
            ]}
          />
        </Group>

        <Group title="ENSv2 infrastructure" footer="Per-pass resolvers and registries are proxies deployed through the ENSv2 VerifiableFactory.">
          <KV
            rows={[
              ["VerifiableFactory", <Addr a={d.factory} />],
              ["UserRegistry impl", <Addr a={d.registryImpl} />],
              ["PermissionedResolver impl", <Addr a={d.resolverImpl} />],
              ["Payment token", <Addr a={d.usdc} />],
            ]}
          />
        </Group>
      </div>
    </div>
  );
}
