/**
 * The accounts reserved for the end-to-end tests (the same addresses as e2e/support/account.ts). They stay in
 * the system because the append-only audit log refers to them, but the Users page shows them apart from the
 * real people, in a closed "Test accounts" section. Pure: no server or browser code.
 */
export const TEST_ACCOUNT_EMAILS: readonly string[] = ["e2e-staff@ctyhp.vn", "e2e-staff-b@ctyhp.vn", "e2e-admin@ctyhp.vn"];

export function isTestAccount(email: string): boolean {
  return TEST_ACCOUNT_EMAILS.includes(email.toLowerCase());
}

/** Real people and test accounts, each in the order they came in. */
export function splitTestAccounts<T extends { email: string }>(rows: readonly T[]): { people: T[]; tests: T[] } {
  const people: T[] = [];
  const tests: T[] = [];
  for (const row of rows) (isTestAccount(row.email) ? tests : people).push(row);
  return { people, tests };
}
