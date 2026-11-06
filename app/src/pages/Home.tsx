import { useState } from "react";
import { ArrowRight, BadgeCheck, Bot, Clock3, CreditCard, FlaskConical, LayoutGrid, ShieldCheck, Smartphone, TimerOff } from "lucide-react";
import { Button, Countdown, NetworkNote, Tile } from "../components/ui";
import { useOnShift } from "../lib/onshift";
import { deployment, explorerAddress, networkLabel } from "../lib/config";
import { usdc } from "../lib/format";
import { ThemeToggle, navigate, type Route } from "../App";

const REPO = "https://github.com/devhb1/onshift";

const DOORS: { route: Route; icon: typeof Clock3; title: string; body: string; cta: string }[] = [
  { route: "try", icon: FlaskConical, title: "Try it as a team lead", body: "Issue a real pass on the live deployment with your own wallet. Up to an hour, up to $5.", cta: "Open Playground" },
  { route: "device", icon: Smartphone, title: "I'm on shift", body: "Your pass, your limits and nothing else. The key stays on this device.", cta: "Open Staff App" },
  { route: "verify", icon: BadgeCheck, title: "Check someone", body: "Is this person or agent working for them right now? One ENS lookup, no account.", cta: "Open Public Check" },
];

const STEPS: { icon: typeof Clock3; title: string; body: string }[] = [
  { icon: Clock3, title: "Issue", body: "A lead gives a phone or an AI agent an ENSv2 name such as shift-0412.ops.onshift.eth, with its own resolver, a cap and an expiry." },
  { icon: ShieldCheck, title: "Work", body: "The pass can refund paid orders up to its cap, and only back to the wallet that paid. It cannot be transferred, extended or re-pointed." },
  { icon: TimerOff, title: "Expire", body: "When the shift ends the name stops resolving and the gate refuses it. Nobody has to send a transaction. Break-glass ends every pass at once." },
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
        <h1 className="landing-title">Keys that clock out.</h1>
        <p className="landing-sub">
          Give staff and AI agents an ENS name for one shift, not a key forever. Every pass is time-boxed, budget-capped and checkable by anyone.
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
