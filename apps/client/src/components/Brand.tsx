export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "brand brand--compact" : "brand"} aria-label="LumenTV">
      <img
        src="/logo.png"
        alt="LumenTV"
        className={compact ? "brand__logo brand__logo--compact" : "brand__logo"}
        draggable={false}
      />
    </span>
  );
}
