export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand brand--compact" : "brand"} aria-label="LumenTV">
      <span className="brand__mark" aria-hidden="true">
        <span className="brand__mark-core">L</span>
      </span>
      {!compact && (
        <span className="brand__name">
          <span>Lumen</span><strong>TV</strong>
        </span>
      )}
    </span>
  );
}
