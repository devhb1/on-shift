import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { CheckCircle2, Copy, Info, Loader2, XCircle, type LucideIcon } from "lucide-react";
import type { PassState } from "../lib/onshift";
import { useChainNow } from "../lib/onshift";
import { duration } from "../lib/format";
import { useSession } from "../lib/session";

export function Card({
  title,
  icon: Icon,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div className="card-title">
            {Icon && <Icon size={18} />}
            {title}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  icon: Icon,
  value,
  label,
  tone = "",
}: {
  icon: LucideIcon;
  value: ReactNode;
  label: string;
  tone?: "" | "green" | "red" | "amber";
}) {
  return (
    <div className="card stat">
      <div className={`stat-icon ${tone}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

const STATE_PILL: Record<PassState, { tone: string; text: string }> = {
  live: { tone: "green", text: "On shift" },
  expired: { tone: "grey", text: "Expired" },
  revoked: { tone: "red", text: "Revoked" },
  killed: { tone: "amber", text: "Stopped (incident)" },
};

export function StatePill({ state }: { state: PassState }) {
  const p = STATE_PILL[state];
  return <span className={`pill ${p.tone}`}>{p.text}</span>;
}

export function Pill({ tone, children }: { tone: "green" | "red" | "amber" | "grey" | "blue"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Countdown({ expiry, className = "" }: { expiry: number; className?: string }) {
  const now = useChainNow();
  return <span className={`mono ${className}`}>{duration(Math.max(0, expiry - now))}</span>;
}

export function Progress({ value, max }: { value: bigint; max: bigint }) {
  const pct = max === 0n ? 0 : Number((value * 1000n) / max) / 10;
  return (
    <div className={`progress ${pct >= 80 ? "warn" : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function Button({
  children,
  variant = "",
  size = "",
  loading = false,
  icon: Icon,
  block = false,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "" | "primary" | "danger" | "danger-solid";
  size?: "" | "sm" | "lg";
  loading?: boolean;
  icon?: LucideIcon;
  block?: boolean;
}) {
  const cls = ["btn", variant && `btn-${variant}`, size && `btn-${size}`, block && "btn-block", rest.className]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} className={cls} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={34} />
      <div style={{ fontWeight: 600, color: "var(--text)" }}>{title}</div>
      {children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

export function Qr({ value, label }: { value: string; label?: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 0, width: 300, color: { dark: "#1f2a3c", light: "#ffffff" } }).then(setSrc);
  }, [value]);
  return src ? <img className="qr" src={src} alt={label ?? "QR code"} /> : <div className="qr" />;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { notify } = useSession();
  return (
    <button
      className="btn btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => notify({ tone: "info", title: "Copied to clipboard" }),
          () => notify({ tone: "error", title: "Could not copy" }),
        );
      }}
    >
      <Copy size={14} /> {label}
    </button>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useSession();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.tone === "success" ? <CheckCircle2 size={20} /> : t.tone === "error" ? <XCircle size={20} /> : <Info size={20} />}
          <div>
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="small muted">{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
