import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { AlertTriangle, BadgeCheck, Bot, Search, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Button, Card, CopyButton, Countdown, Qr } from "../components/ui";
import { useOnShift, type PassRow } from "../lib/onshift";
import { publicClient } from "../lib/clients";
import { deployment, VERIFIED_ORGS } from "../lib/config";
import { levenshtein, short, usdc } from "../lib/format";
import { passIssuerAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";

type Result =
  | { kind: "invalid"; name: string }
  | { kind: "foreign"; name: string; org: string; lookalike?: string }
  | {
      kind: "pass";
      name: string;
      label: string;
      live: boolean;
      incident: boolean;
      issued: boolean;
      row?: PassRow;
      expiry: number;
      holder?: Address;
      role?: string;
      org?: string;
      status?: string;
      agentContext?: string;
      cap: bigint;
      spent: bigint;
      registry: Address;
      block: bigint;
    };

export function Verify({ initialName }: { initialName: string }) {
  const { snapshot } = useOnShift();
  const d = deployment!;
  const [input, setInput] = useState(initialName);
  const [result, setResult] = useState<Result>();
  const [loading, setLoading] = useState(false);

  const check = useCallback(
    async (raw: string) => {
      const name = raw.trim().toLowerCase().replace(/\.$/, "");
      if (!name) return;
      setLoading(true);
      try {
        const suffix = `.ops.${d.orgName}`;
        let label: string;
        if (!name.includes(".")) label = name;
        else if (name.endsWith(suffix)) label = name.slice(0, -suffix.length);
        else {
          const parts = name.split(".");
          const org = parts.slice(-2).join(".");
          const lookalike = VERIFIED_ORGS.find((v) => v !== org && levenshtein(v, org) <= 2);
          setResult({ kind: "foreign", name, org, lookalike });
          return;
        }
        if (!/^[a-z0-9-]{1,32}$/.test(label)) {
          setResult({ kind: "invalid", name });
          return;
        }
        const fullName = `${label}${suffix}`;
        const [status, byLabel, opsStatus, block] = await Promise.all([
          publicClient.readContract({ address: d.shiftGate, abi: shiftGateAbi, functionName: "passStatus", args: [label] }),
          publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "getPassByLabel", args: [label] }),
          publicClient.readContract({ address: d.parentResolver, abi: permissionedResolverAbi, functionName: "text", args: [d.orgNode, "ops.status"] }),
          publicClient.getBlockNumber(),
        ]);
        const [pass, found] = byLabel;
        let role: string | undefined, org: string | undefined, agentContext: string | undefined;
        if (status.live) {
          const node = await publicClient.readContract({
            address: d.passIssuer,
            abi: passIssuerAbi,
            functionName: "nodeOf",
            args: [label],
          });
          [role, org, agentContext] = await Promise.all(
            ["role", "org", "agent-context"].map((k) =>
              publicClient.readContract({ address: status.resolver, abi: permissionedResolverAbi, functionName: "text", args: [node, k] }),
            ),
          );
        }
        const subregistry = snapshot?.currentOps ?? d.opsRegistry;
        setResult({
          kind: "pass",
          name: fullName,
          label,
          live: status.live,
          incident: opsStatus === "incident",
          issued: found,
          row: snapshot?.passes.find((p) => p.label === label && p.isLatestForLabel),
          expiry: Number(status.live ? status.expiry : found ? pass.expiry : 0n),
          holder: status.live ? status.latestOwner : found ? pass.holder : undefined,
          role: role ?? (found ? snapshot?.presets[pass.presetId]?.name : undefined),
          org,
          status: status.shiftStatus,
          agentContext: agentContext || undefined,
          cap: status.cap,
          spent: status.spent,
          registry: subregistry,
          block,
        });
      } finally {
        setLoading(false);
      }
    },
    [d, snapshot],
  );

  useEffect(() => {
    if (initialName) {
      setInput(initialName);
      check(initialName);
    }
    // only when the link changes
  }, [initialName]);

  // keep a displayed result fresh, so a pass visibly flips to NOT ON SHIFT at expiry
  useEffect(() => {
    if (result?.kind !== "pass") return;
    const t = setInterval(() => check(result.name), 3000);
    return () => clearInterval(t);
  }, [result?.kind, result?.name, check]);

  const examples = (snapshot?.passes ?? []).filter((p) => p.isLatestForLabel).slice(0, 4);
  const shareUrl = result && result.kind === "pass" ? `${window.location.origin}${window.location.pathname}#/verify?name=${encodeURIComponent(result.name)}` : "";

  return (
    <div className="grid grid-main">
      <div className="stack" style={{ gap: 22 }}>
        <Card title="Check a name" icon={Search}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              check(input);
            }}
          >
            <div className="row">
              <input
                className="input"
                placeholder={`shift-0412.ops.${d.orgName}`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Name to verify"
                autoFocus
              />
              <Button variant="primary" icon={Search} loading={loading} type="submit">
                Verify
              </Button>
            </div>
            {examples.length > 0 && (
              <div className="row row-wrap small">
                <span className="muted">Recent:</span>
                {examples.map((p) => (
                  <button
                    key={p.index}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setInput(p.name);
                      check(p.name);
                    }}
                  >
                    {p.label}
                  </button>
                ))}
                <button type="button" className="chip-btn" onClick={() => { setInput("support.ops.acrne.eth"); check("support.ops.acrne.eth"); }}>
                  support.ops.acrne.eth
                </button>
              </div>
            )}
          </form>
        </Card>

        {result && <Verdict result={result} />}
      </div>

      <div className="stack" style={{ gap: 22 }}>
        <Card title="Why you can trust this" icon={ShieldCheck}>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li>The answer is read directly from Ethereum, not from {d.orgName}'s servers. Anyone can repeat it.</li>
            <li>A pass is on shift only if the ENS registry says it is registered and not past its end time - the same check the payment gate uses.</li>
            <li>Passes cannot be transferred, so the holder is the person {d.orgName} issued it to.</li>
            <li>Look-alike organisations (like acrne.eth) are flagged.</li>
          </ul>
        </Card>
        {shareUrl && (
          <Card title="Share this check" icon={BadgeCheck}>
            <div className="stack" style={{ alignItems: "center" }}>
              <Qr value={shareUrl} label="Verify link" />
              <CopyButton value={shareUrl} label="Copy link" />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Verdict({ result }: { result: Result }) {
  const d = deployment!;
  if (result.kind === "invalid") {
    return (
      <Card>
        <div className="verdict">
          <div className="verdict-icon red"><ShieldX size={44} /></div>
          <div className="verdict-title red">NOT A VALID PASS NAME</div>
          <p className="muted">"{result.name}" is not a name OnShift could have issued.</p>
        </div>
      </Card>
    );
  }
  if (result.kind === "foreign") {
    return (
      <Card>
        <div className="verdict">
          <div className="verdict-icon red"><AlertTriangle size={44} /></div>
          <div className="verdict-title red">NOT VERIFIED</div>
          {result.lookalike ? (
            <p>
              <b>{result.org}</b> looks like <b>{result.lookalike}</b> but is a different organisation. This is a common
              impersonation trick. Do not share codes, payments or personal details.
            </p>
          ) : (
            <p className="muted">{result.org} is not an organisation this verifier knows.</p>
          )}
        </div>
      </Card>
    );
  }

  const on = result.live;
  const reason = result.incident
    ? "Incident mode: the organisation stopped every pass."
    : !result.issued
      ? "No pass with this name was ever issued."
      : result.row?.state === "revoked"
        ? "This pass was revoked early."
        : "The shift has ended.";
  return (
    <Card>
      {result.incident && (
        <div className="banner red" style={{ marginBottom: 18 }}>
          <ShieldAlert size={20} /> {d.orgName} is in incident mode. Treat anyone claiming to act for it with care.
        </div>
      )}
      <div className="verdict">
        <div className={`verdict-icon ${on ? "green" : "red"}`}>{on ? <ShieldCheck size={46} /> : <ShieldX size={46} />}</div>
        <div className={`verdict-title ${on ? "green" : "red"}`}>{on ? "ON SHIFT" : "NOT ON SHIFT"}</div>
        <div className="badge-name" style={{ marginTop: 6 }}>{result.name}</div>
        {!on && <p className="muted">{reason}</p>}
      </div>
      {on && (
        <dl className="kv">
          <dt>Acting for</dt>
          <dd>{result.org || d.orgName}</dd>
          <dt>Role</dt>
          <dd>{result.role}</dd>
          <dt>Time left</dt>
          <dd><Countdown expiry={result.expiry} /></dd>
          <dt>Current status</dt>
          <dd>{result.status || "-"}</dd>
          {result.cap > 0n && (
            <>
              <dt>Spending limit</dt>
              <dd>{usdc(result.cap - result.spent)} of {usdc(result.cap)} left</dd>
            </>
          )}
          {result.agentContext && (
            <>
              <dt><Bot size={14} /> AI agent</dt>
              <dd style={{ fontWeight: 500 }}>{result.agentContext}</dd>
            </>
          )}
        </dl>
      )}
      <details className="tech" style={{ marginTop: 18 }}>
        <summary>Technical details</summary>
        <dl className="kv small">
          <dt>Check</dt>
          <dd>getState(labelhash) on the live ops registry</dd>
          <dt>ops registry</dt>
          <dd className="mono">{short(result.registry)}</dd>
          <dt>Holder</dt>
          <dd className="mono">{result.holder ? short(result.holder) : "-"}</dd>
          <dt>Block</dt>
          <dd className="mono">{result.block.toString()}</dd>
        </dl>
      </details>
    </Card>
  );
}
