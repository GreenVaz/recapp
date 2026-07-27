import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { postRecurring } from "@/lib/recurring";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => ({ transaction: await postRecurring(id) }));
}
