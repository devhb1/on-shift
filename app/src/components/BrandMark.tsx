type Props = {
  size?: number;
  light?: boolean;
  className?: string;
  withWord?: boolean;
  sub?: string;
};

/** Shared OnShift mark — shift-clock ring + check, brand palette. */
export function BrandMark({ size = 32, light = false, className, withWord = false, sub }: Props) {
  const src = light ? "/brand/onshift-mark-light.svg" : "/brand/onshift-mark.svg";
  return (
    <span className={`brand-mark ${className ?? ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <img src={src} width={size} height={size} alt="" style={{ borderRadius: Math.round(size * 0.25), flex: "none" }} />
      {withWord && (
        <span className="brand-mark-copy">
          <span className="brand-mark-word">OnShift</span>
          {sub && <span className="brand-mark-sub">{sub}</span>}
        </span>
      )}
    </span>
  );
}
