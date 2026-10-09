import { describe, expect, it, vi, type Mock } from "vitest";
import { purgeSequence, type PurgeSteps } from "@/admin/purge";

function steps(over: Partial<PurgeSteps> = {}) {
  const s = {
    load: vi.fn(async () => ({ name: "Ring 5", paths: ["id/source.pdf", "id/thumb.jpg"], inTrash: true })),
    removeFiles: vi.fn(async () => true),
    purgeRecord: vi.fn(async () => "ok" as const),
    ...over,
  };
  return s as unknown as { [K in keyof PurgeSteps]: Mock<PurgeSteps[K]> };
}

describe("purgeSequence (UC-17)", () => {
  it("removes the files first, then the record", async () => {
    const s = steps();
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("ok");
    expect(s.removeFiles).toHaveBeenCalledWith(["id/source.pdf", "id/thumb.jpg"]);
    expect(s.removeFiles.mock.invocationCallOrder[0]).toBeLessThan(s.purgeRecord.mock.invocationCallOrder[0]);
  });

  it("needs the exact name (BR-16)", async () => {
    const s = steps();
    expect(await purgeSequence(s, "id", "ring 5")).toBe("name_mismatch");
    expect(await purgeSequence(s, "id", "Ring 5 ")).toBe("name_mismatch");
    expect(s.removeFiles).not.toHaveBeenCalled();
  });

  it("refuses a sheet that is not in the Trash or is gone", async () => {
    expect(await purgeSequence(steps({ load: vi.fn(async () => ({ name: "Ring 5", paths: [], inTrash: false })) }), "id", "Ring 5")).toBe("not_in_trash");
    expect(await purgeSequence(steps({ load: vi.fn(async () => null) }), "id", "Ring 5")).toBe("not_found");
  });

  it("keeps the record when the files cannot be removed, and a retry completes (TC-75)", async () => {
    let calls = 0;
    const s = steps({ removeFiles: vi.fn(async () => ++calls > 1) });
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("files_failed");
    expect(s.purgeRecord).not.toHaveBeenCalled();
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("ok");
    expect(s.purgeRecord).toHaveBeenCalledTimes(1);
  });

  it("passes on a restore that happened between the check and the purge", async () => {
    expect(await purgeSequence(steps({ purgeRecord: vi.fn(async () => "not_in_trash" as const) }), "id", "Ring 5")).toBe("not_in_trash");
  });
});
