import { Skeleton } from '@/components/ui/skeleton';

export default function LeadsLoading() {
  return (
    <div className="space-y-3 px-4 py-5 sm:px-6">
      <div className="flex justify-between">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="surface overflow-hidden">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: 10 }).map((_, index) => (
          <Skeleton key={index} className="mx-3 my-3 h-6 rounded" />
        ))}
      </div>
    </div>
  );
}
