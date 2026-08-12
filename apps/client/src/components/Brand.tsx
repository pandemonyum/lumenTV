export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "brand brand--compact" : "brand"} aria-label="LumenTV">
      <span className="brand__mark">L</span>
      {!compact && <span className="brand__name">LumenTV</span>}
    </div>
  );
}
