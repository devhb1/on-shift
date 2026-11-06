import { useState } from "react";
import { ArrowRight, BadgeCheck, Bot, Clock3, CreditCard, FlaskConical, LayoutGrid, ShieldCheck, Smartphone, TimerOff } from "lucide-react";
import { Button, Countdown, NetworkNote, Tile } from "../components/ui";
import { useOnShift } from "../lib/onshift";
import { deployment, explorerAddress, networkLabel } from "../lib/config";
import { usdc } from "../lib/format";
import { ThemeToggle, navigate, type Route } from "../App";

const REPO = "https://github.com/devhb1/onshift";

const DOORS: { route: Route; icon: typeof Clock3; title: string; body: string; cta: string }[] = [
  { route: "verify", icon: BadgeCheck, title: "Check someone", body: "Paste a name. If they DMed you as support, this is the check. No account.", cta: "Open Public Check" },
  { route: "try", icon: FlaskConical, title: "Issue a pass", body: "Any wallet can mint a real ENSv2 name on this deployment. An hour, $5, then it dies.", cta: "Open Playground" },
  { route: "device", icon: Smartphone, title: "I'm on shift", body: "Refunds only go back to the wallet that paid. You cannot pick a recipient.", cta: "Open Staff App" },
];

const STEPS: { icon: typeof Clock3; title: string; body: string }[] = [
  { icon: BadgeCheck, title: "Check", body: "A stranger resolves the name through ENS. On shift or not, with no app login and no trust in this website." },
  { icon: ShieldCheck, title: "Pay and refund", body: "The till only sends money back to the wallet that paid that order. A stolen phone cannot redirect it." },
  { icon: TimerOff, title: "Clock out", body: "The name expires by itself. Break-glass aliases the till to quarantine and re-points ops, so every human and agent fails the same check." },
];

export function Home() {
  const { snapshot, error } = useOnShift();
  const d = deployment;
  const [name, setName] = useState("");
  const live = snapshot?.passes.filter((p) => p.state === "live") ?? [];
  const example = live[0];
  const check = (value: string) => navigate("verify", value ? { name: value } : undefined);

  return (
    <div className="landing">
      <NetworkNote compact />
      <header className="landing-bar">
        <div className="app-mark">
          <span className="app-icon">
            <Clock3 size={18} strokeWidth={2.4} />
          </span>
          <div className="app-title">OnShift</div>
        </div>
        <div className="row">
          <ThemeToggle />
          <Button icon={LayoutGrid} onClick={() => navigate("overview")}>
            Console
          </Button>
        </div>
      </header>

      <section className="landing-hero">
        <h1 className="landing-title">A fake support agent fails this check.</h1>
        <p className="landing-sub">
          A real one can only send money back to you. Staff and AI agents get an ENS name for one shift — anyone can resolve it, and the till will not pay a different wallet.
        </p>
        <form
          className="landing-check"
          onSubmit={(e) => {
            e.preventDefault();
            check(name.trim());
          }}
        >
          <input className="input input-lg" placeholder={example ? example.name : `shift-0412.ops.${d?.orgName ?? "onshift.eth"}`} value={name} onChange={(e) => setName(e.target.value)} aria-label="Pass name to check" />
          <Button variant="primary" size="lg" type="submit" icon={BadgeCheck}>
            Is it on shift?
          </Button>
        </form>
        {example && (
          <button className="landing-live" onClick={() => check(example.name)}>
            <span className="dot-live" /> {example.name} is on shift for <Countdown expiry={example.expiry} />
          </button>
        )}
      </section>

      <section className="doors">
        {DOORS.map((door) => (
          <button key={door.route} className="door" onClick={() => navigate(door.route)}>
            <Tile icon={door.icon} tint={door.route === "try" ? "blue" : "soft"} large />
            <div className="door-title">{door.title}</div>
            <div className="door-body">{door.body}</div>
            <div className="door-cta">
              {door.cta} <ArrowRight size={14} />
            </div>
          </button>
        ))}
      </section>

      <section className="steps">
        {STEPS.map((step, i) => (
          <div key={step.title} className="step">
            <div className="step-num">{i + 1}</div>
            <div>
              <div className="step-title">
                <step.icon size={15} /> {step.title}
              </div>
              <div className="step-body">{step.body}</div>
            </div>
          </div>
        ))}
      </section>

      {snapshot && d && (
        <section className="proof">
          <div className="proof-stats">
            <div>
              <div className="proof-value">{live.length}</div>
              <div className="proof-label">on shift now</div>
            </div>
            <div>
              <div className="proof-value">{snapshot.passes.length}</div>
              <div className="proof-label">passes issued</div>
            </div>
            <div>
              <div className="proof-value">{snapshot.orders.length}</div>
              <div className="proof-label">orders paid</div>
            </div>
            <div>
              <div className="proof-value">{usdc(snapshot.gateFloat)}</div>
              <div className="proof-label">in the gate (test USDC)</div>
            </div>
          </div>
          <p className="small secondary">
            Every number here is read from {networkLabel} {error ? "(reconnecting…)" : "right now"}. Contracts:{" "}
            <a href={explorerAddress(d.passIssuer)} target="_blank" rel="noreferrer">
              PassIssuer
            </a>
            ,{" "}
            <a href={explorerAddress(d.shiftGate)} target="_blank" rel="noreferrer">
              ShiftGate
            </a>
            {d.playground && (
              <>
                ,{" "}
                <a href={explorerAddress(d.playground)} target="_blank" rel="noreferrer">
                  Playground
                </a>
              </>
            )}
            . Source on{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
          <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <Button icon={CreditCard} onClick={() => navigate("pay")}>
              Pay as a Customer
            </Button>
            <Button icon={Bot} onClick={() => navigate("deployment")}>
              How It's Deployed
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
