import { describe, it, expect } from "vitest";
import {
  isTestResidue,
  idleDays,
  pickResidueCandidates,
  type HygieneProject,
} from "./project-hygiene";

// 本机真实样本（2026-09-10 实测抓取），固化「真实项目不能被误判」这条保命线
const realSample: HygieneProject = {
  id: "real-1",
  name: "示例 · 山海拾遗（仙侠）",
  nodeCount: 3,
  updatedAt: "2026-09-02T07:16:23Z",
};

const residues: HygieneProject[] = [
  { id: "r1", name: "P2003-DEFENSE-V350", nodeCount: 0, updatedAt: "2026-08-21T07:42:08Z" },
  { id: "r2", name: "FT-VERIFY-V350", nodeCount: 0, updatedAt: "2026-08-21T07:42:07Z" },
  { id: "r3", name: "FREETALK-TEST", nodeCount: 0, updatedAt: "2026-08-21T07:28:05Z" },
  { id: "r4", name: "EXPLORE-FIX-TEST", nodeCount: 0, updatedAt: "2026-08-21T06:39:17Z" },
  { id: "r5", name: "自检测试项目", nodeCount: 0, updatedAt: "2026-08-30T04:01:31Z" },
];

const NOW = Date.parse("2026-09-10T00:00:00Z");

describe("isTestResidue", () => {
  it("有正文的项目绝不判为残留（保命线）", () => {
    expect(isTestResidue(realSample)).toBe(false);
    // 哪怕名字很可疑，只要有正文就不能动
    expect(isTestResidue({ name: "TEST-我的小说", nodeCount: 1 })).toBe(false);
  });

  it("零章节 + 测试名 → 判为残留", () => {
    for (const r of residues) expect(isTestResidue(r)).toBe(true);
  });

  it("零章节但名字正常 → 不判为残留（保守）", () => {
    expect(isTestResidue({ name: "我的第一本书", nodeCount: 0 })).toBe(false);
    // 「探讨中的小说」实测就是零章节但名字正常，必须放过
    expect(isTestResidue({ name: "探讨中的小说", nodeCount: 0 })).toBe(false);
  });

  it("空值/脏数据不炸", () => {
    expect(isTestResidue({ name: "", nodeCount: 0 })).toBe(false);
    expect(isTestResidue({ name: "x", nodeCount: NaN })).toBe(false);
  });
});

describe("idleDays", () => {
  it("按天取整计算闲置天数", () => {
    expect(idleDays("2026-09-08T00:00:00Z", NOW)).toBe(2);
    expect(idleDays("2026-08-21T00:00:00Z", NOW)).toBe(20);
  });
  it("缺失或非法日期安全返回 0", () => {
    expect(idleDays(null, NOW)).toBe(0);
    expect(idleDays("not-a-date", NOW)).toBe(0);
  });
});

describe("pickResidueCandidates", () => {
  it("只挑残留，且放过真实项目", () => {
    const list = [realSample, ...residues, { id: "n1", name: "探讨中的小说", nodeCount: 0 }];
    const got = pickResidueCandidates(list as HygieneProject[], NOW);
    expect(got.map((g) => g.id).sort()).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(got.some((g) => g.id === "real-1")).toBe(false);
  });

  it("结果带可读理由与闲置天数", () => {
    const [one] = pickResidueCandidates([residues[0]] as HygieneProject[], NOW);
    expect(one.reason).toContain("零章节");
    expect(one.reason).toContain("名称像测试");
    // r1 的 updatedAt 是 2026-08-21T07:42 —— 到 9/10 零点只有 19 个「完整天」，
    // idleDays 向下取整（不足一天不算），所以是 19 而非 20。这条固化该取整规则。
    expect(one.idleDays).toBe(19);
  });

  it("空列表或非数组不炸", () => {
    expect(pickResidueCandidates([], NOW)).toEqual([]);
    expect(pickResidueCandidates(undefined as unknown as HygieneProject[], NOW)).toEqual([]);
  });

  it("同名的多份残留都会被列出（实测有两份 EXPLORE-FIX-TEST）", () => {
    const dup = [residues[3], { ...residues[3], id: "r4b" }];
    expect(pickResidueCandidates(dup as HygieneProject[], NOW)).toHaveLength(2);
  });
});
