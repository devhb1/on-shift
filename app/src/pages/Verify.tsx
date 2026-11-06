import { useCallback, useEffect, useState } from "react";
import { keccak256, toBytes, type Address } from "viem";
import { AlertTriangle, BadgeCheck, Check, Clock3, Link2, Search, ShieldAlert, X } from "lucide-react";
import { Button, Countdown, Group, KV, Tile } from "../components/ui";
import { publicClient } from "../lib/clients";
import { passNode } from "../lib/onshift";
import { deployment, isLocal, networkLabel, VERIFIED_ORGS } from "../lib/config";
import { clock, levenshtein, short, usdc } from "../lib/format";
import { passIssuerAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";
import { ThemeToggle, navigate } from "../App";

type Result =
  | { kind: "invalid"; name: string }
  | { kind: "foreign"; name: string; org: string; lookalike?: string }
  | {
      kind: "pass";
      name: string;
      live: boolean;
      incident: boolean;
      issued: boolean;
      revoked: boolean;
      expiry: number;
      holder?: Address;
      role?: string;
      status?: string;
      agentContext?: string;
      cap: bigint;
      spent: bigint;
      block: bigint;
    };

export function Verify({ initialName }: { initialName: string }) {
  const d = deployment!;
  const [input, setInput] = useState(initialName);
  const [result, setResult] = useState<Result>();
  const [loading, setLoading] = useState(false);

  const check = useCallback(
    async (raw: string, quiet = false) => {
      const name = raw.trim().toLowerCase().replace(/\.$/, "");
      if (!name) return;
      if (!quiet) setLoading(true);
      try {
        const suffix = `.ops.${d.orgName}`;
        let label: string;
        if (!name.includes(".")) label = name;
        else if (name.endsWith(suffix)) label = name.slice(0, -suffix.length);
        else {
          const org = name.split(".").slice(-2).join(".");
          setResult({ kind: "foreign", name, org, lookalike: VERIFIED_ORGS.find((v) => v !== org && levenshtein(v, org) <= 2) });
          return;
        }
        if (!/^[a-z0-9-]{1,32}$/.test(label)) {
          setResult({ kind: "invalid", name });
          return;
        }
        const [status, indexPlusOne, opsStatus, block] = await Promise.all([
          publicClient.readContract({ address: d.shiftGate, abi: shiftGateAbi, functionName: "passStatus", args: [label] }),
          publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "latestPassIndexPlusOne", args: [keccak256(toBytes(label))] }),
          publicClient.readContract({ address: d.parentResolver, abi: permissionedResolverAbi, functionName: "text", args: [d.orgNode, "ops.status"] }),
          publicClient.getBlockNumber(),
        ]);
        const found = indexPlusOne > 0n;
        const pass = found
          ? await publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "getPass", args: [indexPlusOne - 1n] })
          : undefined;
        let role: string | undefined, agentContext: string | undefined;
        if (found) {
          const node = passNode(label);
          [role, agentContext] = await Promise.all(
            ["role", "agent-context"].map((k) => publicClient.readContract({ address: pass!.resolver, abi: permissionedResolverAbi, functionName: "text", args: [node, k] })),
          );
        }
        setResult({
          kind: "pass",
          name: `${label}${suffix}`,
          live: status.live,
          incident: opsStatus === "incident",
          issued: found,
          revoked: found && !status.live && Number(status.expiry) > 0 && Number(status.expiry) < Number(pass!.expiry),
          expiry: Number(status.live ? status.expiry : pass ? pass.expiry : 0n),
          holder: pass?.holder,
          role,
          status: status.shiftStatus,
          agentContext: agentContext || undefined,
          cap: status.cap,
          spent: status.spent,
          block,
        });
      } catch {
        setResult(undefined);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [d],
  );

  useEffect(() => {
    if (initialName) {
      setInput(initialName);
      check(initialName);
    }
  }, [initialName, check]);

  // keep a shown result fresh, so a pass visibly flips to "Not on shift" when it ends
  useEffect(() => {
    if (result?.kind !== "pass") return;
    const t = setInterval(() => check(result.name, true), isLocal ? 3000 : 10000);
    return () => clearInterval(t);
  }, [result?.kind, result?.name, check]);

  return (
    <div className="public">
      <nav className="public-nav">
        <a href="#/verify" className="row" style={{ color: "var(--label)", fontWeight: 600 }}>
          <span className="app-icon" style={{ width: 24, height: 24, borderRadius: 6 }}>
            <Clock3 size={13} strokeWidth={2.6} />
          </span>
          OnShift
        </a>
        <div className="row">
          <ThemeToggle />
          <a href="#/overview">For organizations</a>
        </div>
      </nav>

      <section className="hero">
        <h1 className="hero-title">Is this person really on shift?</h1>
        <p className="hero-sub">Check any OnShift name before you share a code, a payment or your details. The answer comes from Ethereum, not from us.</p>
        <form
          className="verify-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) navigate("verify", { name: input.trim() });
            check(input);
          }}
        >
          <div className="search" style={{ flex: 1 }}>
            <Search size={18} style={{ left: 16 }} />
            <input
              className="input input-lg"
              style={{ paddingLeft: 44, background: "var(--surface)", borderColor: "var(--separator)" }}
              placeholder={`shift-0412.ops.${d.orgName}`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Name to check"
              autoFocus
            />
          </div>
          <Button variant="primary" size="lg" loading={loading} type="submit">
            Check
          </Button>
        </form>
      </section>

      <section className="result">{result && <Verdict result={result} />}</section>

      <section className="how">
        <Group pad>
          <Tile icon={BadgeCheck} tint="blue" />
          <div style={{ fontWeight: 600, marginTop: 10 }}>Real names only</div>
          <p className="small secondary" style={{ marginTop: 4 }}>
            Staff and agents get a name under {d.orgName}. Look-alikes such as {d.orgName.replace("i", "l")} are flagged.
          </p>
        </Group>
        <Group pad>
          <Tile icon={Clock3} tint="green" />
          <div style={{ fontWeight: 600, marginTop: 10 }}>Right now, not last week</div>
          <p className="small secondary" style={{ marginTop: 4 }}>
            Passes end on their own when a shift ends. An old screenshot can't make someone look on duty.
          </p>
        </Group>
        <Group pad>
          <Tile icon={Link2} tint="indigo" />
          <div style={{ fontWeight: 600, marginTop: 10 }}>Checkable by anyone</div>
          <p className="small secondary" style={{ marginTop: 4 }}>
            The same ENS records the payment system uses. Wallets and other apps can check them too.
          </p>
        </Group>
      </section>
      <p className="footnote" style={{ textAlign: "center", margin: "40px 0" }}>
        Reading {networkLabel} · ENSv2
      </p>
    </div>
  );
}

function Verdict({ result }: { result: Result }) {
  const d = deployment!;
  if (result.kind !== "pass") {
    return (
      <Group>
        <div className="verdict">
          <div className="seal red">
            <AlertTriangle size={36} />
          </div>
          <div className="verdict-title">Not verified</div>
          <p className="secondary" style={{ marginTop: 8 }}>
            {result.kind === "invalid" ? (
              <>“{result.name}” isn't a name OnShift could have issued.</>
            ) : result.lookalike ? (
              <>
                <b style={{ color: "var(--label)" }}>{result.org}</b> looks like <b style={{ color: "var(--label)" }}>{result.lookalike}</b> but is a different organization. This is a common impersonation trick — don't share codes, payments or personal details.
              </>
            ) : (
              <>{result.org} isn't an organization this checker knows.</>
            )}
          </p>
        </div>
      </Group>
    );
  }

  const on = result.live;
  const why = result.incident
    ? `${d.orgName} has stopped all staff passes because of an incident.`
    : !result.issued
      ? "No pass with this name has ever been issued."
      : result.revoked
        ? "This pass was revoked early."
        : `This shift ended at ${clock(result.expiry)}.`;

  return (
    <div className="stack" style={{ gap: 16 }}>
      {result.incident && (
        <div className="status-strip alert">
          <Tile icon={ShieldAlert} tint="red" />
          <div>
            <div className="strip-title">{d.orgName} is in incident mode</div>
            <div className="small secondary">Treat anyone claiming to act for {d.orgName} with care.</div>
          </div>
        </div>
      )}
      <Group>
        <div className="verdict">
          <div className={`seal ${on ? "green" : "red"}`}>{on ? <Check size={40} strokeWidth={3} /> : <X size={40} strokeWidth={3} />}</div>
          <div className="verdict-title">{on ? "On shift" : "Not on shift"}</div>
          <div className="secondary" style={{ marginTop: 6, wordBreak: "break-all" }}>{result.name}</div>
          {!on && <p className="secondary small" style={{ marginTop: 8 }}>{why}</p>}
        </div>
        {on && (
          <KV
            rows={[
              ["Works for", <span className="check-ok">{d.orgName} ✓</span>],
              ["Role", result.role ?? "—"],
              ["On shift until", <>{clock(result.expiry)} · <Countdown expiry={result.expiry} /> left</>],
              ...(result.status ? ([["Note", result.status]] as [string, string][]) : []),
              ...(result.cap > 0n ? ([["Can refund up to", usdc(result.cap - result.spent)]] as [string, string][]) : []),
              ...(result.agentContext ? ([["AI agent", result.agentContext]] as [string, string][]) : []),
            ]}
          />
        )}
      </Group>
      <p className="footnote" style={{ textAlign: "center" }}>
        Checked on {networkLabel} at block {result.block.toString()}
        {result.holder ? ` · holder ${short(result.holder)}` : ""}
      </p>
    </div>
  );
}
