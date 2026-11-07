import { useState, useSyncExternalStore } from "react";
import { BadgeCheck, CreditCard, Smartphone, Wallet } from "lucide-react";
import { navigate } from "../App";
import { PLAY_STEPS, getPlayLoop, subscribePlayLoop } from "../lib/playLoop";
import { useSession } from "../lib/session";
import { short } from "../lib/format";
import { Button, Row } from "./ui";

type Kind = "done" | "here" | "ready" | "later";

type StepView = {
  label: string;
  kind: Kind;
  open: boolean;
  status: string;
  title: string;
  body: string;
  when?: string;
  cta?: string;
  go: () => void;
};

/**
 * Playground path. Forward steps that are open navigate.
 * Steps that are still closed stay on this screen and say why, and when they open.
 * Org admin can connect, issue, and pay. The device that holds the pass signs the refund.
 */
export function PlayJourney({
  variant = "pills",
  compact = false,
  passName,
  hasOrder,
  refunded,
  holderHere = false,
  onRefund,
}: {
  variant?: "pills" | "list";
  /** Shorter copy for the staff desk — keeps the refund CTA above the fold. */
  compact?: boolean;
  /** Demo name already on screen. Used when this tab has not stored the playground loop yet. */
  passName?: string;
  hasOrder?: boolean;
  refunded?: boolean;
  /** This screen is the pass holder. That key signs refunds. */
  holderHere?: boolean;
  onRefund?: () => void;
}) {
  const { operator, operatorRole, connectWallet } = useSession();
  const loop = useSyncExternalStore(subscribePlayLoop, getPlayLoop, () => undefined);
  const name = passName ?? loop?.name;
  const order = hasOrder ?? Boolean(loop?.orderId);
  const didRefund = refunded ?? Boolean(loop?.refundedAt);
  const connected = Boolean(operator);
  const roleName = !operator ? "No wallet" : operatorRole === "org" ? "Org admin" : operatorRole === "lead" ? "Shift lead" : "This wallet";

  let stage = 0;
  if (connected) stage = 1;
  if (connected && name) stage = 2;
  if (connected && name && (order || didRefund)) stage = 3;
  if (connected && name && didRefund) stage = 4;

  const [picked, setPicked] = useState<{ stage: number; index: number } | null>(null);
  const shown = picked && picked.stage === stage ? picked.index : stage;

  const steps: StepView[] = [
    {
      label: PLAY_STEPS[0],
      open: true,
      title: connected ? "Wallet connected" : "Connect a wallet",
      body: compact
        ? connected
          ? `${roleName} connected. Issue and pay from this wallet; the pass key refunds.`
          : "Connect any wallet. Org admin is enough."
        : connected
          ? `${roleName} can issue a demo pass and pay the sandbox till. The staff device holds the pass and signs refunds.`
          : "Playground accepts any wallet. Org admin is enough. That wallet issues the demo pass and pays the sandbox. The pass key stays on the staff device.",
      cta: connected ? undefined : "Connect wallet",
      go: () => (connected ? navigate("try") : connectWallet()),
    },
    {
      label: PLAY_STEPS[1],
      open: connected,
      title: name ? "Pass issued" : "Issue the demo pass",
      body: compact
        ? name
          ? `${name} is live. Pay the sandbox next.`
          : "Issue a demo pass onto a device in this browser."
        : name
          ? `${name} is on a device. The connected wallet can pay the sandbox next.`
          : "Issue it on Playground, onto a device in this browser. The name ends in .demo. Org admin can issue it. A shift-lead role is not required.",
      when: connected ? undefined : "As soon as a wallet is connected. Org admin can issue. No staff role is required.",
      cta: name ? undefined : "Issue on Playground",
      go: () => navigate("try"),
    },
    {
      label: PLAY_STEPS[2],
      open: connected && Boolean(name),
      title: order || didRefund ? "Sandbox paid" : "Pay the sandbox",
      body: compact
        ? order || didRefund
          ? "Order is on the sandbox till. Refund it from this device."
          : "Pay the sandbox with test USDC. That creates the order to refund."
        : order || didRefund
          ? "An order is on the sandbox till. The device that holds the pass refunds it. The money can only return to the wallet that paid."
          : `${roleName} pays the sandbox till with test USDC. Org admin is allowed to pay. The payment creates the order this device refunds.`,
      when: "Right after a demo pass exists. The organisation wallet can pay. It does not need a staff role, and it does not skip issuing.",
      cta: order || didRefund ? undefined : "Pay the sandbox",
      go: () => navigate("pay", { demo: "1" }),
    },
    {
      label: PLAY_STEPS[3],
      open: order && !didRefund,
      title: didRefund ? "Refund confirmed" : "Refund the order",
      body: compact
        ? didRefund
          ? "Refunded to the payer. Open Public Check next."
          : holderHere
            ? "This device signs the refund. Money returns only to the wallet that paid."
            : "Open the staff app on the device that holds the pass."
        : didRefund
          ? "The order went back to the payer. Public Check should show this name as a demo pass."
          : holderHere
            ? "This device holds the pass, so this device signs the refund. The organisation wallet cannot sign it. The money returns only to the wallet that paid."
            : "The pass holder signs the refund. Open the staff app on that device. The connected wallet stays on the paying side, even when it is org admin.",
      when: "After the sandbox till has a paid order. The staff device that holds the pass then signs the refund. Org admin can pay that order. The holder key is the refund signer.",
      cta: didRefund ? undefined : holderHere ? "Refund this order" : "Open the staff app",
      go: () => (holderHere && onRefund ? onRefund() : navigate("device")),
    },
    {
      label: PLAY_STEPS[4],
      open: Boolean(name),
      title: "Check the name",
      body: compact
        ? name
          ? `Public Check for ${name}. No wallet needed.`
          : "Anyone can open Public Check."
        : name
          ? `Anyone can open Public Check for ${name}. No wallet role is involved. After the refund, the record should read as a demo pass.`
          : "Public Check reads the demo name. Anyone can open it. Org admin has no extra gate on this step.",
      when: "As soon as the demo name exists. The highlight moves here after the refund, when the record should say demo.",
      cta: "Check the name",
      go: () => name && navigate("verify", { name }),
    },
  ].map((step, i) => {
    const kind: Kind = i < stage ? "done" : i === stage ? "here" : step.open ? "ready" : "later";
    const status = kind === "done" ? "Done" : kind === "here" ? "Now" : kind === "ready" ? "Open" : "Later";
    return { ...step, kind, status };
  });

  const view = steps[shown] ?? steps[stage];
  const pick = (index: number) => {
    const step = steps[index];
    const alreadyShowing = shown === index;
    setPicked({ stage, index });
    if (!step) return;
    // Finished steps stay clickable so the pass is not a dead end.
    if (index < stage) {
      step.go();
      return;
    }
    if (!step.open) return;
    if (index === stage || alreadyShowing) step.go();
  };

  const note = (
    <div className={`journey-note ${view.kind === "later" ? "blocked" : ""}`}>
      <b>
        {view.kind === "later" ? `Step ${shown + 1} stays closed` : view.title}
      </b>
      <p>{view.body}</p>
      {view.kind === "later" && view.when && <p className="when">Opens when: {view.when}</p>}
      {view.cta && (view.kind === "here" || view.kind === "ready") && (
        <Button
          variant="primary"
          icon={shown === 0 ? Wallet : shown === 2 ? CreditCard : shown === 3 ? Smartphone : BadgeCheck}
          onClick={() => view.go()}
          style={{ marginTop: 10 }}
        >
          {view.cta}
        </Button>
      )}
    </div>
  );

  if (variant === "list") {
    const who = operator ? `${roleName} · ${short(operator.signer.address)}` : "No wallet connected";
    return (
      <section>
        <div className="group-title">
          <span>Sandbox walkthrough</span>
        </div>
        <div className="group">
          {steps.map((step, i) => (
            <Row
              key={step.label}
              title={
                <span className="step-title">
                  <span className={`step-idx ${step.kind}`}>{i + 1}</span>
                  {step.label}
                </span>
              }
              subtitle={step.kind === "later" ? "Later · tap to see when" : step.status}
              selected={shown === i}
              onClick={() => pick(i)}
            />
          ))}
          {note}
        </div>
        <div className="group-foot journey-foot">
          {who}. This wallet issues and pays. The device holding the pass signs refunds. Org admin does not skip a step.
        </div>
      </section>
    );
  }

  return (
    <div className={`journey-wrap ${compact ? "compact" : ""}`}>
      <ol className="journey" aria-label="Demo path">
        {steps.map((step, i) => (
          <li key={step.label}>
            <button type="button" className={`journey-pill ${step.kind} ${shown === i ? "picked" : ""}`} onClick={() => pick(i)}>
              <span>{i + 1}</span>
              {compact ? ["Connect", "Issue", "Pay", "Refund", "Check"][i] : step.label}
            </button>
          </li>
        ))}
      </ol>
      {note}
      {compact && operator && (
        <p className="journey-foot compact-foot">
          {roleName} · {short(operator.signer.address)} issues &amp; pays · this device refunds
        </p>
      )}
    </div>
  );
}
