export function Loading({ label = "Caricamento" }: { label?: string }) {
  return (
    <div className="loading-view" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}
