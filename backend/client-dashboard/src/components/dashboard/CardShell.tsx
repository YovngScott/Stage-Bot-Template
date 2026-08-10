import { Skeleton } from "@/components/ui/skeleton";

export function CardShell({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "rounded-2xl border border-white/5 bg-card/60 backdrop-blur-xl transition-colors " +
        className
      }
    >
      {title && (
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function KpiSkeleton() {
  return (
    <div className="rounded-2xl border border-white/5 bg-card/60 p-5 backdrop-blur-xl">
      <Skeleton className="h-3 w-24" />
      <div className="mt-4 flex items-end justify-between">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="mt-3 h-3 w-32" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="rounded-2xl border border-white/5 bg-card/60 p-5 backdrop-blur-xl">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-6 h-64 w-full" />
    </div>
  );
}
