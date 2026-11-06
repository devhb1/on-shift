import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { keccak256, toBytes, type Address } from "viem";
import { normalize } from "viem/ens";
import { AlertTriangle, BadgeCheck, Check, Clock3, Link2, ScanLine, Search, ShieldAlert, X } from "lucide-react";
import { Button, Countdown, Group, KV, NetworkNote, Sheet, Tile } from "../components/ui";
import { publicClient } from "../lib/clients";
import { labelId, passNode } from "../lib/onshift";
import { deployment, explorerAddress, isLocal, networkLabel, UNIVERSAL_RESOLVER, VERIFIED_ORGS } from "../lib/config";
import { clock, levenshtein, short, usdc } from "../lib/format";
import { passIssuerAbi, permissionedRegistryAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";
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
      proof: Proof;
    };

/** What an independent ENS client sees: the registry entry and records via the Universal Resolver. */
type Proof = {
  registry: Address;
  registryStatus: string;
  tokenId: bigint;
  resolver?: Address;
  universal: { key: string; value: string | null }[];
  resolves: boolean;
};

const STATUS_NAMES = ["Available", "Reserved", "Registered"];
const PROOF_KEYS = ["org", "role", "shift.status"];

async function readProof(name: string, label: string): Promise<Proof> {
  const d = deployment!;
  const registry = (await publicClient.readContract({ address: d.parentRegistry, abi: permissionedRegistryAbi, functionName: "getSubregistry", args: ["ops"] })) as Address;
  const [state, resolver] = await Promise.all([
    publicClient.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "getState", args: [labelId(label)] }),
    publicClient.readContract({ address: registry, abi: permissionedRegistryAbi, functionName: "getResolver", args: [label] }),
  ]);
  const universal = UNIVERSAL_RESOLVER
    ? await Promise.all(
        PROOF_KEYS.map(async (key) => {
          try {
            return { key, value: await publicClient.getEnsText({ name: normalize(name), key, universalResolverAddress: UNIVERSAL_RESOLVER }) };
          } catch {
            return { key, value: null };
          }
        }),
      )
    : [];
  return {
    registry,
    registryStatus: STATUS_NAMES[Number(state.status)] ?? String(state.status),
    tokenId: state.tokenId,
    resolver: resolver === "0x0000000000000000000000000000000000000000" ? undefined : (resolver as Address),
    universal,
    resolves: universal.some((r) => !!r.value),
  };
}

const BarcodeDetectorCtor = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;

/** A scanned pass QR is the verify URL; plain names work too. */
function nameFromScan(raw: string) {
  try {
    const hash = new URL(raw).hash;
    const q = hash.split("?")[1];
    const name = q ? new URLSearchParams(q).get("name") : null;
    if (name) return name;
  } catch {
    /* not a URL */
  }
  return raw.trim();
}

export function Verify({ initialName }: { initialName: string }) {
  const d = deployment!;
  const [input, setInput] = useState(initialName);
  const [result, setResult] = useState<Result>();
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

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
        const fullName = `${label}${suffix}`;
        const [status, indexPlusOne, opsStatus, block, proof] = await Promise.all([
          publicClient.readContract({ address: d.shiftGate, abi: shiftGateAbi, functionName: "passStatus", args: [label] }),
          publicClient.readContract({ address: d.passIssuer, abi: passIssuerAbi, functionName: "latestPassIndexPlusOne", args: [keccak256(toBytes(label))] }),
          publicClient.readContract({ address: d.parentResolver, abi: permissionedResolverAbi, functionName: "text", args: [d.orgNode, "ops.status"] }),
          publicClient.getBlockNumber(),
          readProof(fullName, label),
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
          proof,
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
          <a href="#/home">Home</a>
          <a href="#/overview">Console</a>
        </div>
      </nav>
      <NetworkNote compact />

      <section className="hero">
        <h1 className="hero-title">Is this person really on shift?</h1>
        <p className="hero-sub">Check a pass name before you share a code, a payment, or your details. The answer is read from Ethereum{isLocal ? "" : " Sepolia"}.</p>
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
          {BarcodeDetectorCtor && (
            <Button size="lg" type="button" icon={ScanLine} onClick={() => setScanning(true)} aria-label="Scan a pass QR code">
              Scan
            </Button>
          )}
        </form>
      </section>
      {scanning && (
        <Scanner
          onClose={() => setScanning(false)}
          onFound={(raw) => {
            setScanning(false);
            const name = nameFromScan(raw);
            setInput(name);
            navigate("verify", { name });
            check(name);
          }}
        />
      )}

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
      {result.issued && <ProofPanel proof={result.proof} />}
    </div>
  );
}

function ProofPanel({ proof }: { proof: Proof }) {
  const link = (a: Address) => (
    <a href={explorerAddress(a)} target="_blank" rel="noreferrer" className="mono">
      {short(a)}
    </a>
  );
  return (
    <details className="proof-panel">
      <summary>Show proof</summary>
      <p className="small secondary" style={{ margin: "8px 0 12px" }}>
        {UNIVERSAL_RESOLVER ? (
          <>
            Read through the ENS Universal Resolver ({short(UNIVERSAL_RESOLVER)}), the same entry point wallets and explorers use. {proof.resolves ? "The name resolves." : "The name no longer resolves: its registry entry has no resolver, so there is nothing to fall back to."}
          </>
        ) : (
          "Read from the registry and the pass resolver."
        )}
      </p>
      <KV
        rows={[
          ["Registry (live ops pointer)", link(proof.registry)],
          ["Registry state", proof.registryStatus],
          ["Token ID", <span className="mono">{proof.tokenId.toString().slice(0, 12)}…</span>],
          ["Pass resolver", proof.resolver ? link(proof.resolver) : "none"],
          ...proof.universal.map((r) => [<span className="mono">{r.key}</span>, r.value ? r.value : <span className="secondary">not set</span>] as [ReactNode, ReactNode]),
        ]}
      />
    </details>
  );
}

function Scanner({ onFound, onClose }: { onFound: (raw: string) => void; onClose: () => void }) {
  const [error, setError] = useState<string>();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const detector = BarcodeDetectorCtor ? new BarcodeDetectorCtor({ formats: ["qr_code"] }) : undefined;
    const tick = async () => {
      if (stopped || !detector || !video.current) return;
      try {
        const [code] = await detector.detect(video.current);
        if (code?.rawValue) return onFound(code.rawValue);
      } catch {
        /* frame not ready */
      }
      timer = setTimeout(tick, 300);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        video.current.play().then(tick, tick);
      })
      .catch(() => setError("Camera not available. Type the name instead."));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onFound]);
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Scan a pass</div>
      <p className="secondary small" style={{ margin: "6px 0 14px" }}>Point the camera at the QR code on the staff app.</p>
      {error ? <p className="small">{error}</p> : <video ref={video} className="scanner" muted playsInline />}
      <Button block onClick={onClose} style={{ marginTop: 14 }}>
        Cancel
      </Button>
    </Sheet>
  );
}
