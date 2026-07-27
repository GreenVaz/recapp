import { NextRequest } from "next/server";
import { handle } from "@/lib/api";
import { transactionUpdateSchema } from "@/lib/validation";
import { deleteTransaction, updateTransaction } from "@/lib/transactions";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    const data = transactionUpdateSchema.parse(await req.json());
    return updateTransaction(id, {
      ...data,
      date: data.date ? new Date(data.date) : undefined,
    });
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    await deleteTransaction(id);
    return { ok: true };
  });
}
