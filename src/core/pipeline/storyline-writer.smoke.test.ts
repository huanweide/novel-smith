// P1-8 冒烟测试：writeStorylineProgress 三态（空输入/低分跳过/合法大事写库）
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    storyline: { findUnique: vi.fn() },
    storylineEvent: { create: vi.fn() },
  },
  withStorylineLock: vi.fn(async (_id: string, fn: () => Promise<any>) => fn()),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/core/story-status", () => ({
  STORYLINE_STATUS: { ACTIVE: "active" },
  withStorylineLock: mocks.withStorylineLock,
}));

import { writeStorylineProgress } from "./storyline-writer";

describe("writeStorylineProgress 冒烟（P1-8）", () => {
  it("空/非数组输入 → 不碰 DB，无异常", async () => {
    await expect(writeStorylineProgress("p1", "n1", 0, [])).resolves.toBeUndefined();
    await expect(writeStorylineProgress("p1", "n1", 0, null as any)).resolves.toBeUndefined();
    expect(mocks.prisma.storyline.findUnique).not.toHaveBeenCalled();
  });

  it("impactScore<4 → 跳过，不写事件", async () => {
    mocks.prisma.storyline.findUnique.mockResolvedValue({ projectId: "p1", status: "active" });
    await writeStorylineProgress("p1", "n1", 0, [
      { storylineId: "s1", stage: "desire", progressNote: "觉醒", impactScore: 2 },
    ]);
    expect(mocks.prisma.storylineEvent.create).not.toHaveBeenCalled();
  });

  it("合法大事（impactScore>=4）→ 写入 MILESTONE 事件", async () => {
    mocks.prisma.storyline.findUnique.mockResolvedValue({ projectId: "p1", status: "active" });
    mocks.prisma.storylineEvent.create.mockResolvedValue({});
    await writeStorylineProgress("p1", "n1", 3, [
      { storylineId: "s1", stage: "desire", progressNote: "主角觉醒，立下大志", impactScore: 5 },
    ]);
    expect(mocks.withStorylineLock).toHaveBeenCalledWith("s1", expect.any(Function));
    expect(mocks.prisma.storylineEvent.create).toHaveBeenCalledTimes(1);
    const data = mocks.prisma.storylineEvent.create.mock.calls[0][0].data;
    expect(data.kind).toBe("MILESTONE");
    expect(data.title).toContain("欲望推进");
  });
});
