import { Bot, Clock3 } from "lucide-react";
import type { PassRow, Preset } from "../lib/onshift";
import { clock, usdc } from "../lib/format";
import { deployment } from "../lib/config";
import { Countdown, useQr } from "./ui";

const STYLE: Record<string, string> = { Cashier: "cashier", Support: "support", "AI agent": "agent", "Door staff": "door" };

export const verifyUrl = (name: string) =>
  `${window.location.origin}${window.location.pathname}#/verify?name=${encodeURIComponent(name)}`;

/** A Wallet-style pass: role colour, the ENS name as the headline, and a QR anyone can scan to verify. */
export function PassCard({ pass, preset, small = false, showCode = true }: { pass: PassRow; preset?: Preset; small?: boolean; showCode?: boolean }) {
  const live = pass.state === "live";
  const qr = useQr(verifyUrl(pass.name));
  const style = live ? (STYLE[preset?.name ?? ""] ?? "cashier") : "ended";
  return (
    <div className={`pass ${style} ${small ? "pass-sm" : ""}`}>
      <div className="pass-head">
        <div className="pass-org">
          <span className="pass-org-mark">{preset?.agent ? <Bot size={14} /> : <Clock3 size={14} />}</span>
          {deployment?.orgName}
        </div>
        <span>{preset?.name}</span>
      </div>
      <div className="pass-name">{pass.name}</div>
      <div className="pass-fields">
        <div>
          <div className="pass-label">{live ? "Time left" : "Status"}</div>
          <div className="pass-field-value">{live ? <Countdown expiry={pass.expiry} /> : pass.state === "revoked" ? "Revoked" : pass.state === "killed" ? "Stopped" : "Ended"}</div>
        </div>
        <div>
          <div className="pass-label">{live ? "Ends" : "Ended"}</div>
          <div className="pass-field-value">{clock(pass.expiry)}</div>
        </div>
        <div>
          <div className="pass-label">Limit left</div>
          <div className="pass-field-value">{pass.cap > 0n ? usdc(pass.cap - pass.spent) : "—"}</div>
        </div>
      </div>
      {showCode && !small && (
        <>
          <div className="pass-code">{qr && <img src={qr} alt="Scan to verify this pass" />}</div>
          <div className="pass-code-caption">Scan to check this pass is real</div>
        </>
      )}
    </div>
  );
}
