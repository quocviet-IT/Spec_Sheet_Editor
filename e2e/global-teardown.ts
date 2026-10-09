import { STAFF_B_EMAIL, adminId, restoreStaff, staffBId, staffId, suspendAdmin } from "./support/account";
import { deleteSheetsOf } from "./support/db";
import { restoreSettingsSnapshot } from "./support/settings";

/**
 * Cleans up the three reserved accounts even when one step fails; the first failure is reported.
 * Staff B goes back to Staff and active, whatever an Admin test left behind; the shared settings are written back
 * from the snapshot taken by global setup; the reserved Admin is suspended again (setup makes it active).
 */
export default async function globalTeardown(): Promise<void> {
  const results = await Promise.allSettled([
    staffId().then(deleteSheetsOf),
    staffBId().then(deleteSheetsOf),
    adminId().then(deleteSheetsOf),
    restoreStaff(STAFF_B_EMAIL),
    restoreSettingsSnapshot(),
    suspendAdmin(),
  ]);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}
