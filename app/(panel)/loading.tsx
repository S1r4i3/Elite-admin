/** Shown inside the (already rendered) sidebar shell the moment a link is clicked. */
export default function Loading() {
  return (
    <div className="page-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="sk sk-title" />
      <div className="sk sk-line" style={{ width: "40%" }} />
      <div className="sk-grid">
        <div className="sk sk-card" />
        <div className="sk sk-card" />
        <div className="sk sk-card" />
        <div className="sk sk-card" />
      </div>
      <div className="sk sk-table" />
    </div>
  );
}
