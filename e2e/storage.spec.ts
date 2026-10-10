import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { admin } from "./support/db";

test("TC-51 a signed link stops working after its time is up", async () => {
  const bucket = admin().storage.from("spec-sheets");
  // A folder name that cannot be a sheet id, so no sheet and no clean-up treats it as theirs.
  const path = `e2e-tc51-${randomUUID().slice(0, 8)}/probe.txt`;
  try {
    const uploaded = await bucket.upload(path, Buffer.from("probe"), { contentType: "image/png" } /* the bucket accepts only the sheet file types */);
    expect(uploaded.error, "probe not uploaded").toBeNull();
    const signed = await bucket.createSignedUrl(path, 1);
    expect(signed.error, "signed link not made").toBeNull();
    const url = signed.data!.signedUrl;

    await new Promise((r) => setTimeout(r, 3000));
    const response = await fetch(url);
    expect(response.ok).toBe(false);
    expect(await response.text()).toMatch(/expired|[^a-z]exp[^a-z]/i); // the service answers InvalidJWT: "exp" claim timestamp check failed
  } finally {
    const removed = await bucket.remove([path]);
    if (removed.error) throw new Error(`probe not removed: ${removed.error.message}`);
  }
});
