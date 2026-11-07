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
const RING = 527.8;

const ATTACKS: { try: string; result: string; who: string; ok?: boolean }[] = [
  { try: "Send the refund to their own wallet", result: "EACUnauthorizedAccountRoles", who: "Permissioned Resolver" },
  { try: "Raise their own cap", result: "EACUnauthorizedAccountRoles", who: "Issuer-only scope" },
  { try: "Transfer or sell the pass", result: "TransferDisallowed", who: "roleBitmap = 0" },
  { try: "Refund an order nobody paid", result: "UnknownOrder", who: "ShiftGate" },
  { try: "Refund more than the cap", result: "OverCap", who: "ShiftGate" },
  { try: "Use it after the shift", result: "PassNotLive", who: "ENSv2 expiry" },
  { try: "Refund the real customer, within cap", result: "allowed", who: "The only thing a pass can do", ok: true },
];

const DOORS: { route: Route; icon: typeof BadgeCheck; title: string; body: string; cta: string }[] = [
  { route: "verify", icon: BadgeCheck, title: "Check someone", body: "Paste a name. If they DMed you as support, this is the check.", cta: "Public Check" },
  { route: "try", icon: FlaskConical, title: "Try a demo pass", body: "Mint under demo.onshift.eth — never real staff, never the production till.", cta: "Playground" },
  { route: "device", icon: Smartphone, title: "I'm on shift", body: "Refunds only go back to the wallet that paid.", cta: "Staff App" },
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
    <div className={`landing ns ${dark ? "ns-dark" : "ns-light"}`}>
      <header className="landing-bar">
        <a className="app-mark" href="#/home" aria-label="OnShift home">
          <img src="/brand/onshift-mark.png" width={38} height={38} alt="" style={{ borderRadius: 10 }} />
          <span className="brand-word">OnShift</span>
        </a>
        <div className="row landing-nav">
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
            <b>●</b> {networkLabel} · ENSv2
          </span>
          <ThemeToggle />
          <Button className="landing-console" icon={LayoutGrid} onClick={() => navigate("overview")}>
            Console
          </Button>
        </div>
      </header>

      <section className="landing-hero night-hero">
        <div className="hero-copy">
          <p className="landing-eyebrow">Expiring authority for staff &amp; AI agents · ENSv2</p>
          <h1 className="landing-title">
            Authority that <em>clocks out.</em>
          </h1>
          <p className="landing-sub">
            Give a cashier, a support rep or an AI agent an ENS name that works for one shift, can only refund the wallet that paid, and dies on its own. Anyone can check it in one second.
          </p>
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
              Is it on shift?
            </Button>
          </form>
          <p className="landing-hint">
            Someone DMed you as support? Paste their name. Demo passes live under <code>*.demo.{org}</code> and are marked DEMO on Public Check.
          </p>
        </div>

        <aside className="pass-card" aria-label={example ? "Live pass read from Sepolia" : "No pass is on shift"}>
          {example ? (
            <>
              <div className="pass-top">
                <span className="pass-status">
                  <span className="dot-live" /> {example.sandbox ? "ON SHIFT · DEMO" : "ON SHIFT"}
                </span>
                <span className="pass-org">{org}</span>
              </div>
              <div className="pass-ring">
                <svg viewBox="0 0 190 190" aria-hidden>
                  <circle cx="95" cy="95" r="84" fill="none" stroke="currentColor" strokeWidth="10" className="pass-ring-track" />
                  <circle
                    cx="95"
                    cy="95"
                    r="84"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={RING}
                    strokeDashoffset={ringOffset}
                    transform="rotate(-90 95 95)"
                    className="pass-ring-arc"
                  />
                </svg>
                <div className="pass-ring-label">
                  <div className="pass-time">
                    <Countdown expiry={example.expiry} />
                  </div>
                  <div className="pass-time-sub">left on this shift</div>
                </div>
              </div>
              <div className="pass-name mono">{example.name}</div>
              <div className="pass-kv">
                <div>
                  <small>Role</small>
                  <b>{exampleRole}</b>
                </div>
                <div>
                  <small>Cap left</small>
                  <b>{example.cap > 0n ? usdc(example.cap - example.spent) : "—"}</b>
                </div>
                <div>
                  <small>Holder</small>
                  <b className="mono">{short(example.holder)}</b>
                </div>
              </div>
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
              <p className="landing-sub" style={{ marginTop: 18 }}>
                This card only shows a pass after Sepolia has mined it. There is no sample name and no countdown until then.
              </p>
              <div className="pass-proof">
                <button type="button" onClick={() => navigate("try")}>
                  Issue a real demo pass
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
      </section>

      <section className="doors">
        {DOORS.map((door) => (
          <button key={door.route} className="door" type="button" onClick={() => navigate(door.route)}>
            <door.icon size={22} strokeWidth={2.2} />
            <div className="door-title">{door.title}</div>
            <div className="door-body">{door.body}</div>
            <div className="door-cta">
              {door.cta} <ArrowRight size={14} />
            </div>
          </button>
        ))}
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
