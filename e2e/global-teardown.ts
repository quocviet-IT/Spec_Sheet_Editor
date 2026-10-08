import { staffBId, staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";

/** Cleans up both reserved accounts even when one of them fails; the first failure is reported. */
export default async function globalTeardown(): Promise<void> {
  const results = await Promise.allSettled([staffId().then(deleteSheetsOf), staffBId().then(deleteSheetsOf)]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
