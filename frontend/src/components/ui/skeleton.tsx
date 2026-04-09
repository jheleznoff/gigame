export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-muted ${className}`} />
  );
}

export function ChatSkeleton() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-48" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-20 w-72" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-56" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-16 w-64" />
      </div>
    </div>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
