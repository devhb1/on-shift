import { useState } from "react";
import { ArrowRight, BadgeCheck, FlaskConical, LayoutGrid, Smartphone } from "lucide-react";
import { Button, Countdown } from "../components/ui";
import { useOnShift, useChainNow } from "../lib/onshift";
import { deployment, ensAppUrl, explorerAddress, explorerTx, networkLabel } from "../lib/config";
import { short, usdc } from "../lib/format";
import { passPreset } from "./shared";
import { useTheme } from "../lib/theme";
import { ThemeToggle, navigate, type Route } from "../App";

const REPO = "https://github.com/devhb1/on-shift";
const RING_R = 62;
const RING = 2 * Math.PI * RING_R;

const USPS = [
  "Expires by itself — no revoke tx",
  "Refunds only to the wallet that paid",
  "Anyone checks the same ENSv2 name",
  "Sandbox playground · never production",
];

const ATTACKS: { try: string; result: string; who: string; ok?: boolean }[] = [
  { try: "Send the refund to their own wallet", result: "EACUnauthorizedAccountRoles", who: "Permissioned Resolver" },
  { try: "Raise their own cap", result: "EACUnauthorizedAccountRoles", who: "Issuer-only scope" },
  { try: "Transfer or sell the pass", result: "TransferDisallowed", who: "roleBitmap = 0" },
  { try: "Refund an order nobody paid", result: "UnknownOrder", who: "ShiftGate" },
  { try: "Refund more than the cap", result: "OverCap", who: "ShiftGate" },
  { try: "Use it after the shift", result: "PassNotLive", who: "ENSv2 expiry" },
  { try: "Refund the real customer, within cap", result: "allowed", who: "The only thing a pass can do", ok: true },
];

const DOORS: { route: Route; icon: typeof BadgeCheck; title: string; cta: string; tone: "sky" | "violet" | "teal" }[] = [
  { route: "verify", icon: BadgeCheck, title: "Check a name", cta: "Public Check", tone: "sky" },
  { route: "try", icon: FlaskConical, title: "Try a demo pass", cta: "Playground", tone: "violet" },
  { route: "device", icon: Smartphone, title: "Staff refund", cta: "Staff App", tone: "teal" },
];

export function Home() {
  const { snapshot } = useOnShift();
  const { dark } = useTheme();
  const now = useChainNow();
  const d = deployment;
  const [name, setName] = useState("");
  const staffLive = snapshot?.passes.filter((p) => p.state === "live" && !p.sandbox) ?? [];
  const demoLive = snapshot?.passes.filter((p) => p.state === "live" && p.sandbox) ?? [];
  const example = staffLive[0] ?? demoLive[0];
  const exampleRole = example && snapshot ? passPreset(snapshot, example)?.name ?? "Pass" : "";
  const issueTx = example ? snapshot?.activity.find((a) => a.kind === "issued" && a.label === example.label) : undefined;

  const check = (value: string) => navigate("verify", value ? { name: value } : undefined);
  const org = d?.orgName ?? "onshift.eth";
  const placeholder = example?.name ?? `play-….demo.${org}`;

  let ringOffset = RING;
  if (example) {
    const span = Math.max(1, example.expiry - example.issuedAt);
    const left = Math.max(0, example.expiry - now);
    ringOffset = RING * (1 - left / span);
  }

  return (
    <div className={`landing ns compact ${dark ? "ns-dark" : "ns-light"}`}>
      <header className="landing-bar">
        <a className="app-mark" href="#/home" aria-label="OnShift home">
          <img src="/brand/onshift-mark.svg" width={32} height={32} alt="" style={{ borderRadius: 8 }} />
          <span className="brand-word">OnShift</span>
        </a>
        <div className="row landing-nav">
          <a className="landing-link keep" href="#/try">
            Playground
          </a>
          <a className="landing-link keep" href="#/how">
            How it works
          </a>
          <a className="landing-link" href="#attacks">
            Security
          </a>
          <a className="landing-link" href={REPO} target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span className="landing-net">
            <b>●</b> {networkLabel}
          </span>
          <ThemeToggle />
          <Button className="landing-console" icon={LayoutGrid} onClick={() => navigate("overview")}>
            Console
          </Button>
        </div>
      </header>

      <section className="landing-hero night-hero">
        <div className="hero-copy">
          <p className="landing-eyebrow">Staff &amp; AI agents · ENSv2 · Sepolia</p>
          <h1 className="landing-title">
            Authority that <em>clocks out.</em>
          </h1>
          <p className="landing-sub">
            One ENS name for one shift. Caps what they can touch, refunds only the payer, then dies on its own. Anyone can check.
          </p>

          <ul className="usp-row" aria-label="Why OnShift">
            {USPS.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>

          <form
            className="landing-check"
            onSubmit={(e) => {
              e.preventDefault();
              check(name.trim() || placeholder);
            }}
          >
            <input
              className="input input-lg mono"
              placeholder={placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Pass name to check"
            />
            <Button variant="primary" size="lg" type="submit" icon={BadgeCheck}>
              Check
            </Button>
          </form>

          <div className="hero-ctas">
            <Button variant="primary" size="lg" icon={FlaskConical} onClick={() => navigate("try")}>
              Open Playground
            </Button>
            <Button size="lg" onClick={() => navigate("how")}>
              How it works
            </Button>
          </div>

          <div className="door-strip" aria-label="Start here">
            {DOORS.map((door) => (
              <button key={door.route} type="button" className={`door-chip tone-${door.tone}`} onClick={() => navigate(door.route)}>
                <door.icon size={15} strokeWidth={2.3} />
                <span>{door.title}</span>
                <b>
                  {door.cta} <ArrowRight size={12} />
                </b>
              </button>
            ))}
          </div>
        </div>

        <div className="hero-stage">
          <aside className={`pass-card ${example ? "is-live" : ""}`} aria-label={example ? "Live pass read from Sepolia" : "No pass is on shift"}>
            {example ? (
              <>
                <div className="pass-top">
                  <span className="pass-status">
                    <span className="dot-live" /> {example.sandbox ? "ON SHIFT · DEMO" : "ON SHIFT"}
                  </span>
                  <span className="pass-org">{org}</span>
                </div>
                <div className="pass-ring">
                  <svg viewBox="0 0 140 140" aria-hidden>
                    <defs>
                      <linearGradient id="shiftArc" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#4A90E2" />
                        <stop offset="35%" stopColor="#45C486" />
                        <stop offset="70%" stopColor="#8E71EB" />
                        <stop offset="100%" stopColor="#F5A623" />
                      </linearGradient>
                    </defs>
                    <circle cx="70" cy="70" r={RING_R} fill="none" stroke="currentColor" strokeWidth="9" className="pass-ring-track" />
                    <circle
                      cx="70"
                      cy="70"
                      r={RING_R}
                      fill="none"
                      stroke="url(#shiftArc)"
                      strokeWidth="9"
                      strokeLinecap="round"
                      strokeDasharray={RING}
                      strokeDashoffset={ringOffset}
                      transform="rotate(-90 70 70)"
                      className="pass-ring-arc"
                    />
                  </svg>
                  <div className="pass-ring-label">
                    <div className="pass-time">
                      <Countdown expiry={example.expiry} />
                    </div>
                    <div className="pass-time-sub">left</div>
                  </div>
                </div>
                <div className="pass-name mono">{example.name}</div>
                <div className="pass-kv">
                  <div>
                    <small>Role</small>
                    <b>{exampleRole}</b>
                  </div>
                  <div>
                    <small>Cap</small>
                    <b>{example.cap > 0n ? usdc(example.cap - example.spent) : "—"}</b>
                  </div>
                  <div>
                    <small>Holder</small>
                    <b className="mono">{short(example.holder)}</b>
                  </div>
                </div>
                <ul className="pass-rules compact">
                  <li className="ok">Refund only to the wallet that paid</li>
                  <li className="no">Redirect payouts or raise the cap</li>
                  <li className="no">Transfer the pass</li>
                </ul>
                <p className="pass-proof">
                  <button type="button" onClick={() => navigate("verify", { name: example.name })}>
                    Public check
                  </button>
                  {issueTx && explorerTx(issueTx.txHash) && (
                    <a href={explorerTx(issueTx.txHash)} target="_blank" rel="noreferrer">
                      Issuance tx ↗
                    </a>
                  )}
                  {ensAppUrl(example.name) && (
                    <a href={ensAppUrl(example.name)} target="_blank" rel="noreferrer">
                      ENS ↗
                    </a>
                  )}
                </p>
              </>
            ) : (
              <>
                <div className="pass-top">
                  <span className="pass-status">NOBODY ON SHIFT</span>
                  <span className="pass-org">{org}</span>
                </div>
                <p className="landing-sub" style={{ marginTop: 14, fontSize: 14 }}>
                  The timer appears after a real Sepolia pass is mined. Open the Playground to issue one.
                </p>
                <div className="pass-proof">
                  <button type="button" onClick={() => navigate("try")}>
                    Issue a demo pass
                  </button>
                  {d && (
                    <a href={explorerAddress(d.passIssuer)} target="_blank" rel="noreferrer">
                      PassIssuer ↗
                    </a>
                  )}
                </div>
              </>
            )}
          </aside>
          <button type="button" className="lookalike-card" onClick={() => navigate("verify", { name: "onshlft.eth" })}>
            <span className="lookalike-badge">NOT VERIFIED</span>
            <span className="mono lookalike-name">onshlft.eth</span>
            <span className="lookalike-msg">Look-alike of {org}, flagged.</span>
          </button>
        </div>
      </section>

      <section id="attacks" className="attacks-section">
        <p className="landing-eyebrow">Steal the phone. Try anything.</p>
        <h2 className="section-title">The chain says no — with a reason.</h2>
        <div className="attacks">
          <div className="attacks-head">
            <span>What a thief tries</span>
            <span>What happens</span>
            <span>Who enforces it</span>
          </div>
          {ATTACKS.map((row) => (
            <div key={row.try} className="attacks-row">
              <span>{row.try}</span>
              <span className={row.ok ? "ok" : "err"}>{row.result}</span>
              <span>{row.who}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
