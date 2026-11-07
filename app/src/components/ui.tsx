import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { CheckCircle2, ChevronRight, Copy, Info, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { useChainNow, type PassState } from "../lib/onshift";
import { duration, short } from "../lib/format";
import { deployment, isLocal, networkLabel } from "../lib/config";
import { useSession } from "../lib/session";

export type Tint = "blue" | "green" | "red" | "orange" | "purple" | "indigo" | "teal" | "graphite" | "soft";

export function Group({
  title,
  action,
  footer,
  children,
  pad = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <section>
      {(title || action) && (
        <div className="group-title">
          <span>{title}</span>
          {action}
        </div>
      )}
      <div className={`group ${pad ? "group-pad" : ""}`}>{children}</div>
      {footer && <div className="group-foot">{footer}</div>}
    </section>
  );
}

export function Tile({ icon: Icon, tint = "blue", size = 17, large = false }: { icon: LucideIcon; tint?: Tint; size?: number; large?: boolean }) {
  return (
    <span className={`tile ${tint} ${large ? "tile-lg" : ""}`}>
      <Icon size={large ? 21 : size} strokeWidth={2.2} />
    </span>
  );
}

export function Row({
  icon,
  tint,
  title,
  subtitle,
  trailing,
  onClick,
  chevron,
  selected,
  plain,
}: {
  icon?: LucideIcon;
  tint?: Tint;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  selected?: boolean;
  plain?: boolean;
}) {
  const content = (
    <>
      {icon && <Tile icon={icon} tint={tint} />}
      <div className="row-main">
        <div className="row-title">{title}</div>
        {subtitle && <div className="row-sub">{subtitle}</div>}
      </div>
      {(trailing || chevron) && (
        <div className="row-trail">
          {trailing}
          {chevron && <ChevronRight size={16} className="chev" />}
        </div>
      )}
    </>
  );
  const cls = `list-row ${selected ? "selected" : ""} ${plain || !icon ? "plain" : ""}`;
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl style={{ margin: 0 }}>
      {rows.map(([k, v], i) => (
        <div className="kv-row" key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
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
  variant?: "" | "primary" | "destructive" | "plain" | "plain danger";
  size?: "" | "lg";
  loading?: boolean;
  icon?: LucideIcon;
  block?: boolean;
}) {
  const cls = ["btn", variant && variant.split(" ").map((v) => (v === "danger" ? "danger" : `btn-${v}`)).join(" "), size && `btn-${size}`, block && "btn-block", rest.className]
    .filter(Boolean)
    .join(" ");
  return (
    <button {...rest} className={cls} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={15} className="spin" /> : Icon ? <Icon size={15} strokeWidth={2.2} /> : null}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div className={`seg ${block ? "seg-block" : ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <button className={`switch ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="footnote">{hint}</div>}
    </div>
  );
}

const STATE: Record<PassState, { tone: string; text: string }> = {
  live: { tone: "green", text: "On shift" },
  expired: { tone: "grey", text: "Ended" },
  revoked: { tone: "red", text: "Revoked" },
  killed: { tone: "orange", text: "Stopped" },
};

export function StateBadge({ state }: { state: PassState }) {
  return <span className={`badge ${STATE[state].tone}`}>{STATE[state].text}</span>;
}

export function Badge({ tone, children }: { tone: "green" | "red" | "orange" | "grey" | "blue"; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Countdown({ expiry, className = "" }: { expiry: number; className?: string }) {
  const now = useChainNow();
  return <span className={`tabular ${className}`}>{duration(Math.max(0, expiry - now))}</span>;
}

export function Meter({ value, max }: { value: bigint; max: bigint }) {
  const pct = max === 0n ? 0 : Number((value * 1000n) / max) / 10;
  return (
    <div className={`meter ${pct >= 100 ? "full" : pct >= 80 ? "warn" : ""}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function Ring({ progress, size = 160, stroke = 12, color = "var(--green-solid)", children }: { progress: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          style={{ transition: "stroke-dashoffset 0.6s linear" }}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function useQr(value: string) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(value, { margin: 0, width: 320, color: { dark: "#000000", light: "#ffffff" } }).then(setSrc);
  }, [value]);
  return src;
}

export function Qr({ value, label }: { value: string; label?: string }) {
  const src = useQr(value);
  return src ? <img className="qr" src={src} alt={label ?? "QR code"} /> : <div className="qr" />;
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const { notify } = useSession();
  return (
    <Button
      icon={Copy}
      onClick={() =>
        navigator.clipboard?.writeText(value).then(
          () => notify({ tone: "info", title: "Copied" }),
          () => notify({ tone: "error", title: "Could not copy" }),
        )
      }
    >
      {label}
    </Button>
  );
}

export function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={30} strokeWidth={1.6} color="var(--tertiary)" />
      <div className="empty-title">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

/** Shown on the hosted app so nobody mistakes testnet balances for dollars. */
export function NetworkNote({ compact = false }: { compact?: boolean }) {
  if (isLocal || !deployment) return null;
  return (
    <div className="net-note">
      {networkLabel} testnet. Amounts are test USDC, not dollars.
      {compact ? "" : ` ${deployment.orgName} is administered by ${short(deployment.org)}, one wallet.`}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useSession();
  return (
    <div className="hud" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => (t.href ? window.open(t.href, "_blank", "noopener") : dismiss(t.id))}>
          {t.tone === "success" ? (
            <CheckCircle2 size={20} className="ico-success" />
          ) : t.tone === "error" ? (
            <XCircle size={20} className="ico-error" />
          ) : (
            <Info size={20} className="ico-info" />
          )}
          <div>
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
            {t.href && (
              <a className="toast-tx" href={t.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                View transaction ↗
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
