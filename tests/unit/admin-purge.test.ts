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
  it("deletes the record first, then the files", async () => {
    const s = steps();
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("ok");
    expect(s.removeFiles).toHaveBeenCalledWith(["id/source.pdf", "id/thumb.jpg"]);
    expect(s.purgeRecord.mock.invocationCallOrder[0]).toBeLessThan(s.removeFiles.mock.invocationCallOrder[0]);
  });

  it("needs the exact name (BR-16)", async () => {
    const s = steps();
    expect(await purgeSequence(s, "id", "ring 5")).toBe("name_mismatch");
    expect(await purgeSequence(s, "id", "Ring 5 ")).toBe("name_mismatch");
    expect(s.purgeRecord).not.toHaveBeenCalled();
    expect(s.removeFiles).not.toHaveBeenCalled();
  });

  it("matches a Vietnamese name typed in decomposed form", async () => {
    const stored = "Nhẫn kim cương".normalize("NFC");
    const s = steps({ load: vi.fn(async () => ({ name: stored, paths: ["id/a"], inTrash: true })) });
    expect(await purgeSequence(s, "id", stored.normalize("NFD"))).toBe("ok");
  });

  it("refuses a sheet that is not in the Trash or is gone", async () => {
    expect(await purgeSequence(steps({ load: vi.fn(async () => ({ name: "Ring 5", paths: [], inTrash: false })) }), "id", "Ring 5")).toBe("not_in_trash");
    expect(await purgeSequence(steps({ load: vi.fn(async () => null) }), "id", "Ring 5")).toBe("not_found");
  });

  it("never removes files when a restore wins the race", async () => {
    const s = steps({ purgeRecord: vi.fn(async () => "not_in_trash" as const) });
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("not_in_trash");
    expect(s.removeFiles).not.toHaveBeenCalled();
  });

  it("TC-75 reports files_left when the files cannot be removed after two tries", async () => {
    const s = steps({ removeFiles: vi.fn(async () => false) });
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("files_left");
    expect(s.removeFiles).toHaveBeenCalledTimes(2);
  });

  it("TC-75 is ok when the second try removes the files", async () => {
    let calls = 0;
    const s = steps({ removeFiles: vi.fn(async () => ++calls > 1) });
    expect(await purgeSequence(s, "id", "Ring 5")).toBe("ok");
    expect(s.removeFiles).toHaveBeenCalledTimes(2);
  });

  it("returns failed when any step throws", async () => {
    expect(await purgeSequence(steps({ load: vi.fn(async () => { throw new Error("db"); }) }), "id", "Ring 5")).toBe("failed");
    expect(await purgeSequence(steps({ purgeRecord: vi.fn(async () => { throw new Error("db"); }) }), "id", "Ring 5")).toBe("failed");
  });
});
