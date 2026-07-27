import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { TransactionsClient } from "./TransactionsClient";

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-24">
          <Loader2 size={20} className="animate-spin text-ink-faint" />
        </div>
      }
    >
      <TransactionsClient />
    </Suspense>
  );
}
