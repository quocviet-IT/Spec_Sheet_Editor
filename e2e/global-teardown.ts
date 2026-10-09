import { STAFF_B_EMAIL, adminId, restoreStaff, staffBId, staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";

/**
 * Cleans up the three reserved accounts even when one step fails; the first failure is reported.
 * Staff B goes back to Staff and active, whatever an Admin test left behind.
 */
export default async function globalTeardown(): Promise<void> {
  const results = await Promise.allSettled([
    staffId().then(deleteSheetsOf),
    staffBId().then(deleteSheetsOf),
    adminId().then(deleteSheetsOf),
    restoreStaff(STAFF_B_EMAIL),
  ]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
