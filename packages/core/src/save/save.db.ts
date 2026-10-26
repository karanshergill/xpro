import type { Result } from "true-myth/result";

// Await only database work here; the transaction stays open for the callback.
export async function save<Value, Failure>(
  storage: DurableObjectStorage,
  action: () => Promise<Result<Value, Failure>>,
): Promise<Result<Value, Failure>> {
  return await storage.transaction(async (transaction) => {
    const result = await action();
    if (result.isErr) transaction.rollback();
    return result;
  });
}
