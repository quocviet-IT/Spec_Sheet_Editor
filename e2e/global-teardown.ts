import { staffId } from "./support/account";
import { deleteSheetsOf } from "./support/db";

export default async function globalTeardown(): Promise<void> {
  await deleteSheetsOf(await staffId());
}
