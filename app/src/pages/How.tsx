import { BrandMark } from "../components/BrandMark";
import { NetworkNote } from "../components/ui";
import { deployment, explorerAddress } from "../lib/config";
import { ThemeToggle, navigate } from "../App";

type Node = { id: string; x: number; y: number; w: number; h: number; title: string; sub: string; tone?: "sky" | "teal" | "violet" | "peach" | "coral" | "ink" };
type Edge = { from: string; to: string; label?: string; bad?: boolean };

function wrap(text: string, max = 28) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function Diagram({
  title,
  caption,
  width,
  height,
  nodes,
  edges,
}: {
  title: string;
  caption: string;
  width: number;
  height: number;
  nodes: Node[];
  edges: Edge[];
}) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const toneFill: Record<string, string> = {
    sky: "var(--diagram-sky)",
    teal: "var(--diagram-teal)",
    violet: "var(--diagram-violet)",
    peach: "var(--diagram-peach)",
    coral: "var(--diagram-coral)",
    ink: "var(--diagram-ink)",
  };
  return (
    <section className="how-block">
      <h2 className="how-kicker">{title}</h2>
      <p>{caption}</p>
      <div className="diagram-shell">
        <svg className="diagram" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
            </marker>
            <marker id="arrow-bad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#f86d70" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const a = byId[e.from];
            const b = byId[e.to];
            if (!a || !b) return null;
            const x1 = a.x + a.w;
            const y1 = a.y + a.h / 2;
            const x2 = b.x;
            const y2 = b.y + b.h / 2;
            const mid = (x1 + x2) / 2;
            return (
              <g key={`${e.from}-${e.to}-${i}`} className={e.bad ? "edge bad" : "edge"}>
                <path
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={e.bad ? "#f86d70" : "currentColor"}
                  strokeWidth="1.6"
                  markerEnd={e.bad ? "url(#arrow-bad)" : "url(#arrow)"}
                />
                {e.label && (
                  <text x={mid} y={(y1 + y2) / 2 - 8} textAnchor="middle" className={e.bad ? "edge-label bad" : "edge-label"}>
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((n) => {
            const lines = wrap(n.sub, 28);
            return (
              <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
                <rect width={n.w} height={n.h} rx="10" className="node-bg" style={{ fill: toneFill[n.tone ?? "ink"] }} />
                <text x="12" y="24" className="node-title">
                  {n.title}
                </text>
                {lines.map((line, li) => (
                  <text key={li} x="12" y={44 + li * 14} className="node-sub-svg">
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

export function How() {
  const d = deployment;
  const org = d?.orgName ?? "onshift.eth";
  return (
    <div className="public">
      <nav className="public-nav">
        <button className="row" style={{ color: "var(--label)", fontWeight: 700, background: "none", border: 0, cursor: "pointer", letterSpacing: "-0.03em" }} onClick={() => navigate("home")}>
          <BrandMark size={26} />
          OnShift
        </button>
        <div className="row">
          <ThemeToggle />
          <a href="#/try">Playground</a>
          <a href="#/verify">Public Check</a>
          <a href="#/overview">Console</a>
        </div>
      </nav>
      <NetworkNote compact />
      <article className="guide">
        <p className="landing-eyebrow" style={{ color: "var(--violet)" }}>How people use OnShift today</p>
        <h1 className="hero-title">Three doors. One chain. No fake proof.</h1>
        <p className="hero-sub">
          Live on Sepolia as {org}. A stranger never gets a staff pass. They either check a name, or they mint a sandbox pass under demo.{org}. Only the organisation wallet issues real ops staff.
        </p>

        <div className="how-roles">
          <div>
            <b>1 · You were DMed</b>
            <span>Landing or Public Check. Paste the name. On shift is getState, not “it resolves.” Demo names are marked DEMO. Look-alike orgs are flagged.</span>
          </div>
          <div>
            <b>2 · You want to try it</b>
            <span>Playground → Issue → View transaction → Pay sandbox → Staff refund → Public Check. Any wallet with a little Sepolia ETH. Never touches the production till.</span>
          </div>
          <div>
            <b>3 · You run the org</b>
            <span>Console with the org wallet. New Pass writes shift-….ops.{org}. That pass refunds production orders. A Playground pass cannot.</span>
          </div>
        </div>

        <Diagram
          title="Judge path · try it in order"
          caption="This is the path a new wallet finishes without being a shift lead. Every step leaves a Sepolia receipt."
          width={920}
          height={168}
          nodes={[
            { id: "a", x: 8, y: 28, w: 170, h: 110, title: "1 · Playground", sub: "tryIt → play-….demo name + Etherscan tx", tone: "violet" },
            { id: "b", x: 240, y: 28, w: 170, h: 110, title: "2 · Pay sandbox", sub: "#/pay?demo=1 · test USDC order on SandboxGate", tone: "sky" },
            { id: "c", x: 472, y: 28, w: 170, h: 110, title: "3 · Staff app", sub: "Holder refunds. Payer is fixed by the order.", tone: "teal" },
            { id: "d", x: 704, y: 28, w: 200, h: 110, title: "4 · Public Check", sub: "Same name. On shift, role, time left, registry proof.", tone: "peach" },
          ]}
          edges={[
            { from: "a", to: "b" },
            { from: "b", to: "c" },
            { from: "c", to: "d" },
          ]}
        />

        <Diagram
          title="Issue path · under the hood"
          caption="Playground calls tryIt. Console New Pass calls issue. Both end as an ENSv2 name with its own Permissioned Resolver."
          width={920}
          height={168}
          nodes={[
            { id: "w", x: 8, y: 28, w: 150, h: 110, title: "Wallet", sub: "Signs + 0.003 ETH drip for the holder", tone: "ink" },
            { id: "i", x: 210, y: 28, w: 170, h: 110, title: "PassIssuer", sub: "Cap, duration, demo vs ops registry", tone: "sky" },
            { id: "r", x: 440, y: 28, w: 190, h: 110, title: "New resolver", sub: "Holder may write only shift.status", tone: "violet" },
            { id: "u", x: 690, y: 28, w: 210, h: 110, title: "UserRegistry", sub: "roleBitmap 0 · expiry · not transferable", tone: "teal" },
          ]}
          edges={[
            { from: "w", to: "i" },
            { from: "i", to: "r" },
            { from: "r", to: "u" },
          ]}
        />

        <Diagram
          title="Money path · two tills"
          caption="A demo pass and a staff pass do not share a till. Paying the shop does not create an order a demo pass can refund."
          width={920}
          height={210}
          nodes={[
            { id: "c", x: 8, y: 50, w: 140, h: 100, title: "Customer", sub: "pay() on a gate", tone: "ink" },
            { id: "s", x: 220, y: 8, w: 180, h: 88, title: "SandboxGate", sub: "demo till · Playground only", tone: "violet" },
            { id: "p", x: 220, y: 112, w: 180, h: 88, title: "ShiftGate", sub: "production till · ops staff", tone: "sky" },
            { id: "o", x: 480, y: 50, w: 170, h: 100, title: "Order", sub: "payer locked in the id", tone: "peach" },
            { id: "h", x: 720, y: 50, w: 180, h: 100, title: "Holder refund", sub: "USDC returns only to payer", tone: "teal" },
          ]}
          edges={[
            { from: "c", to: "s", label: "demo" },
            { from: "c", to: "p", label: "ops" },
            { from: "s", to: "o" },
            { from: "p", to: "o" },
            { from: "o", to: "h" },
          ]}
        />

        <Diagram
          title="Liveness · resolve ≠ on shift"
          caption="Public Check shows both. The only liveness check is registry getState. Text records are what a wallet reads."
          width={920}
          height={200}
          nodes={[
            { id: "n", x: 8, y: 56, w: 150, h: 90, title: "Name", sub: "paste or QR", tone: "ink" },
            { id: "g", x: 220, y: 16, w: 190, h: 88, title: "getState", sub: "REGISTERED + not expired = on shift", tone: "teal" },
            { id: "u", x: 220, y: 116, w: 190, h: 72, title: "Universal Resolver", sub: "org · role · shift.status", tone: "sky" },
            { id: "ok", x: 500, y: 16, w: 170, h: 88, title: "On shift", sub: "Refund path open", tone: "teal" },
            { id: "no", x: 500, y: 116, w: 170, h: 72, title: "Not on shift", sub: "Expired or unregistered", tone: "coral" },
            { id: "bg", x: 740, y: 56, w: 160, h: 90, title: "Break glass", sub: "1 tx · ops re-pointed", tone: "peach" },
          ]}
          edges={[
            { from: "n", to: "g" },
            { from: "n", to: "u" },
            { from: "g", to: "ok" },
            { from: "g", to: "no", bad: true, label: "miss" },
            { from: "ok", to: "bg", label: "incident" },
          ]}
        />

        <Diagram
          title="Integrate later · agents and products"
          caption="Other apps do not need our UI. They read ENSv2 the same way any wallet does, then call ShiftGate with the pass label."
          width={920}
          height={168}
          nodes={[
            { id: "a", x: 8, y: 28, w: 180, h: 110, title: "Your agent / app", sub: "Holds the pass key for one shift", tone: "violet" },
            { id: "b", x: 240, y: 28, w: 190, h: 110, title: "Universal Resolver", sub: "org · role · shift.status · $0 read", tone: "sky" },
            { id: "c", x: 490, y: 28, w: 180, h: 110, title: "getState", sub: "On shift? Expiry? Registry only", tone: "teal" },
            { id: "d", x: 730, y: 28, w: 170, h: 110, title: "ShiftGate", sub: "refund / checkIn within cap", tone: "peach" },
          ]}
          edges={[
            { from: "a", to: "b" },
            { from: "a", to: "c" },
            { from: "c", to: "d", label: "if live" },
          ]}
        />

        <section className="how-block">
          <h2 className="how-kicker">Integration sketch</h2>
          <div className="how-strength">
            <div>
              <b>Read before you trust</b>
              <span>Resolve the name (or call getState on the registry). If it is not REGISTERED or past expiry, refuse. Demo names under demo.{org} are sandbox only.</span>
            </div>
            <div>
              <b>Act with the holder key</b>
              <span>Issue puts the pass on a device or agent wallet. That key calls ShiftGate.refund(label, orderId, amount). The recipient is the order payer — never an argument.</span>
            </div>
            <div>
              <b>Orgs keep the console</b>
              <span>Your product can deep-link to Public Check, or embed the same reads. Issuing staff still goes through PassIssuer with the org wallet (or a future Safe).</span>
            </div>
            <div>
              <b>Agents</b>
              <span>Demo agent preset forces empty agent-context today. A production agent gets a short-lived name, a cap, and the same gate — your agent runtime signs with the holder key until expiry.</span>
            </div>
          </div>
        </section>

        <section className="how-block">
          <h2 className="how-kicker">What makes this a strong project now</h2>
          <div className="how-strength">
            <div>
              <b>ENSv2 is the product</b>
              <span>Per-pass Permissioned Resolver, roleBitmap 0, expiry as revoke, getState liveness, Universal Resolver on Public Check, break-glass via setSubregistry.</span>
            </div>
            <div>
              <b>Sandbox that cannot lie</b>
              <span>Playground mints under demo.{org} only. SandboxGate is a separate till. DEMO is visible on Public Check. Staff passes stay under ops.</span>
            </div>
            <div>
              <b>Stranger can finish the loop</b>
              <span>No org key required: issue → pay sandbox → refund → check. Each step shows a real Sepolia transaction link.</span>
            </div>
            <div>
              <b>Still thin for day-two</b>
              <span>Org is one EOA, not a Safe. No committed public demo URL until you paste it. Agent story is a preset + empty agent-context, not a full agent product.</span>
            </div>
          </div>
        </section>

        {d && (
          <section className="how-block">
            <h2 className="how-kicker">Contracts you can open</h2>
            <p>These are the Sepolia addresses this app reads. A pass that is not in a transaction to one of them is not a pass.</p>
            <div className="how-links">
              <a href={explorerAddress(d.passIssuer)} target="_blank" rel="noreferrer">PassIssuer ↗</a>
              <a href={explorerAddress(d.playground ?? d.passIssuer)} target="_blank" rel="noreferrer">Playground ↗</a>
              <a href={explorerAddress(d.sandboxGate ?? d.shiftGate)} target="_blank" rel="noreferrer">Sandbox gate ↗</a>
              <a href={explorerAddress(d.shiftGate)} target="_blank" rel="noreferrer">Production gate ↗</a>
              <a href={`https://sepolia.app.ens.domains/${org}`} target="_blank" rel="noreferrer">{org} ↗</a>
            </div>
          </section>
        )}

        <div className="play-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate("try")}>
            Start in the Playground
          </button>
          <button className="btn" onClick={() => navigate("verify")}>
            Check a name
          </button>
        </div>
      </article>
    </div>
  );
}
