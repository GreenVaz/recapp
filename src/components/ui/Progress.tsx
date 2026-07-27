import { cn } from "@/lib/cn";

/** Зелений < 80% ≤ жовтий < 100% ≤ червоний. */
export function budgetTone(share: number) {
  if (share >= 100) return { bar: "bg-negative", text: "text-negative", soft: "bg-negative/10" };
  if (share >= 80) return { bar: "bg-warning", text: "text-warning", soft: "bg-warning/10" };
  return { bar: "bg-positive", text: "text-positive", soft: "bg-positive/10" };
}

export function Progress({ share, className }: { share: number; className?: string }) {
  const tone = budgetTone(share);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tone.bar)}
        style={{ width: `${Math.min(share, 100)}%` }}
      />
    </div>
  );
}
