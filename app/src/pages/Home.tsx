import { useEffect, useState } from "react";
import { ArrowRight, BadgeCheck, FlaskConical, LayoutGrid, Smartphone } from "lucide-react";
import { Button, Countdown } from "../components/ui";
import { useOnShift, useChainNow } from "../lib/onshift";
import { deployment, networkLabel } from "../lib/config";
import { useTheme } from "../lib/theme";
import { ThemeToggle, navigate, type Route } from "../App";

const REPO = "https://github.com/devhb1/on-shift";
const RING = 527.8;
const DEMO_TOTAL = 4 * 3600;

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

function formatLeft(secs: number) {
  const h = String(Math.floor(secs / 3600)).padStart(2, "0");
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function Home() {
  const { snapshot } = useOnShift();
  const { dark } = useTheme();
  const now = useChainNow();
  const d = deployment;
  const [name, setName] = useState("");
  const live = snapshot?.passes.filter((p) => p.state === "live") ?? [];
  const example = live[0];
  const exampleRole = example && snapshot ? snapshot.presets[example.presetId]?.name ?? "Cashier" : "Cashier";
  const [demoLeft, setDemoLeft] = useState(3 * 3600 + 41 * 60 + 12);

  useEffect(() => {
    if (example) return;
    const id = setInterval(() => setDemoLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [example]);

  const check = (value: string) => navigate("verify", value ? { name: value } : undefined);
  const org = d?.orgName ?? "onshift.eth";
  const placeholder = example?.name ?? `shift-0412.ops.${org}`;

  let ringOffset = RING * (1 - demoLeft / DEMO_TOTAL);
  if (example) {
    const span = Math.max(1, example.expiry - example.issuedAt);
    const left = Math.max(0, example.expiry - now);
    ringOffset = RING * (1 - left / span);
  }

  return (
    <div className={`landing ns ${dark ? "ns-dark" : "ns-light"}`}>
      <header className="landing-bar">
        <a className="app-mark" href="#/home" aria-label="OnShift home">
          <img src="/brand/onshift-mark.svg" width={34} height={34} alt="" />
          <span className="brand-word">OnShift</span>
        </a>
        <div className="row landing-nav">
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

        <aside className="pass-card" aria-label="Example live pass">
          <div className="pass-top">
            <span className="pass-status">
              <span className="dot-live" /> ON SHIFT
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
              <div className="pass-time">{example ? <Countdown expiry={example.expiry} /> : formatLeft(demoLeft)}</div>
              <div className="pass-time-sub">left on this shift</div>
            </div>
          </div>
          <div className="pass-name mono">
            {example ? (
              example.name
            ) : (
              <>
                shift-0412<span>.ops.{org}</span>
              </>
            )}
          </div>
          <div className="pass-kv">
            <div>
              <small>Role</small>
              <b>{exampleRole}</b>
            </div>
            <div>
              <small>Refund cap</small>
              <b>bound to payer</b>
            </div>
            <div>
              <small>Transfer</small>
              <b className="bad">Locked</b>
            </div>
          </div>
          <p className="pass-proof mono">getState() = REGISTERED · roleBitmap = 0 · UniversalResolverV2</p>
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
