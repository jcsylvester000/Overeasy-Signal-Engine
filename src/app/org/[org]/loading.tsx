export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto max-w-5xl animate-pulse px-4 py-8">
      <div className="mb-6 h-6 w-48 rounded bg-gray-200" />
      <div className="h-40 rounded-lg border border-line bg-panel" />
    </div>
  );
}
