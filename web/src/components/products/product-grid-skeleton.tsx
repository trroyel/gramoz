export function ProductGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 animate-pulse"
        >
          {/* Image placeholder */}
          <div className="aspect-square bg-zinc-200 dark:bg-zinc-800" />
          {/* Content */}
          <div className="p-5 space-y-3">
            <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded-full w-3/4" />
            <div className="h-3 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/2" />
            <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded-full w-1/3" />
          </div>
          {/* Button placeholder */}
          <div className="px-5 pb-5">
            <div className="h-9 bg-zinc-200 dark:bg-zinc-700 rounded-lg w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
