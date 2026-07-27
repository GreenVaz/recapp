import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { getAnalytics } from "@/lib/analytics";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const to = sp.get("to") ? new Date(sp.get("to")!) : new Date();
  const from = sp.get("from")
    ? new Date(sp.get("from")!)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  return handle(() =>
    getAnalytics({
      from,
      to,
      accountId: sp.get("accountId"),
      categoryId: sp.get("categoryId"),
    }),
  );
}
