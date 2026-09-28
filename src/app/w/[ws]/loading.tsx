/** Instant feedback while a workspace page renders on the server (also lets <Link> prefetch up to here). */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-2 h-6 w-64 rounded bg-gray-200" />
      <div className="mb-6 h-4 w-96 max-w-full rounded bg-gray-100" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-line bg-panel" />
        ))}
      </div>
      <div className="h-72 rounded-lg border border-line bg-panel" />
    </div>
  );
}
