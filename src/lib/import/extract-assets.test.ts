import { describe, it, expect } from "vitest";
import {
  sampleChapters,
  extractCharacters,
  extractLore,
  extractCommitments,
  buildTimelineDigest,
  buildStorylineDigest,
  extractAssets,
  summarizeAssets,
  pickRepresentativeSentence,
} from "./extract-assets";
import type { ParsedChapter } from "./types";

/** 造短章 */
function ch(index: number, title: string, content: string): ParsedChapter {
  return { index, title, content, wordCount: content.replace(/\s+/g, "").length };
}

/** 一段带明确角色对话 + 法宝 + 伏笔的短文本 */
const SAMPLE = `
林川站在青云宗的山门前，手里握着那柄青锋剑。
「日后我一定要回来。」林川说道。
旁边的苏长老看了他一眼：「总有一天你会明白，这剑里藏着的东西。」
青云剑忽然震动起来，林川发现剑身上浮现出一道血纹。
他想起师父说过的话：必须找到玄天鼎，才能解开这血纹的来历。
`;

/** 重复 N 遍，让频次投票过门槛 */
function repeat(text: string, n: number): ParsedChapter[] {
  return Array.from({ length: n }, (_, i) => ch(i + 1, `第${i + 1}章`, text));
}

describe("M3 · 采样", () => {
  it("空章集会返回空采样", () => {
    expect(sampleChapters([])).toEqual([]);
  });

  it("短书全采，长书按 head + stride 采样", () => {
    const short = repeat("短文本。", 10);
    expect(sampleChapters(short, { head: 30, stride: 5 })).toHaveLength(10);

    const long = Array.from({ length: 100 }, (_, i) =>
      ch(i + 1, `第${i + 1}章`, "正文内容。"),
    );
    const sampled = sampleChapters(long, { head: 30, stride: 5 });
    // 30 + ceil(70/5) = 44
    expect(sampled.length).toBeLessThan(long.length);
    expect(sampled[0]!.index).toBe(1);
  });

  it("无正文的条目不进采样", () => {
    const s = sampleChapters([ch(1, "第一卷", ""), ch(2, "第一章", "有正文")]);
    expect(s).toHaveLength(1);
    expect(s[0]!.title).toBe("第一章");
  });
});

describe("M3 · 角色识别", () => {
  it("对话标签 + 称谓能识别出主要人物", () => {
    const samples = sampleChapters(repeat(SAMPLE, 8));
    const chars = extractCharacters(samples, { minMentions: 3 });
    const names = chars.map((c) => c.name);
    expect(names).toContain("林川");
  });

  it("「他们/我们」这类代词不会被当人名", () => {
    const samples = sampleChapters(
      repeat("他们走了。我们在此等待。别人说这是他们的命运。", 10),
      { perChapterWords: 400 },
    );
    const names = extractCharacters(samples, { minMentions: 3 }).map((c) => c.name);
    for (const bad of ["他们", "我们", "别人", "自己"]) {
      expect(names).not.toContain(bad);
    }
  });

  it("证据类型会记录下来（speech / honorific）", () => {
    const samples = sampleChapters(repeat(SAMPLE, 8));
    const lin = extractCharacters(samples, { minMentions: 3 }).find(
      (c) => c.name === "林川",
    );
    expect(lin).toBeDefined();
    expect(lin!.evidence.length).toBeGreaterThan(0);
    expect(lin!.firstChapter).toBe(1);
  });
});

describe("M3 · 世界书提炼", () => {
  it("法宝 / 地点能被抽出", () => {
    const samples = sampleChapters(repeat(SAMPLE, 10));
    const lore = extractLore(samples, { minMentions: 3 });
    const names = lore.map((l) => l.name);
    expect(names.some((n) => n.includes("青锋剑"))).toBe(true);
  });

  it("只出现一两次的专名不进门（避免路人甲变设定）", () => {
    // 单章样本：玄天鼎只出现 1 次 → 低于门槛 3，必须被滤掉
    const one = sampleChapters([ch(1, "第一章", SAMPLE)]);
    const strict = extractLore(one, { minMentions: 3 }).map((l) => l.name);
    expect(strict.some((n) => n.includes("玄天鼎"))).toBe(false);
    // 门槛降到 1 才进得来
    const loose = extractLore(one, { minMentions: 1 }).map((l) => l.name);
    expect(loose.some((n) => n.includes("玄天鼎"))).toBe(true);
  });

  it("碎片名被清洗（不把「到玄天鼎」「柄青锋剑」写进世界书）", () => {
    const names = extractLore(sampleChapters(repeat(SAMPLE, 10)), { minMentions: 1 })
      .map((l) => l.name);
    expect(names).toContain("青锋剑");
    expect(names).toContain("玄天鼎");
    for (const bad of ["到玄天鼎", "柄青锋剑", "川发现剑", "现出一道血"]) {
      expect(names).not.toContain(bad);
    }
  });

  it("content 不编设定，只写客观事实", () => {
    const samples = sampleChapters(repeat(SAMPLE, 10));
    const lore = extractLore(samples, { minMentions: 3 });
    for (const l of lore) {
      expect(l.content).toContain("待补");
      expect(l.content.length).toBeLessThan(200);
    }
  });
});

describe("M3 · 伏笔识别", () => {
  it("「日后我一定会回来」被识别为高优先级伏笔", () => {
    const samples = sampleChapters(repeat(SAMPLE, 6));
    const cs = extractCommitments(samples);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.some((c) => c.description.includes("日后"))).toBe(true);
    expect(cs.some((c) => c.priority === "high")).toBe(true);
  });

  it("同一句重复出现只留一条（取最早那章）", () => {
    const samples = sampleChapters(repeat(SAMPLE, 10));
    const cs = extractCommitments(samples);
    const riqi = cs.filter((c) => c.description.includes("日后"));
    expect(riqi).toHaveLength(1);
    expect(riqi[0]!.chapter).toBe(1);
  });

  it("没有线索句式时不硬凑伏笔", () => {
    const samples = sampleChapters(
      repeat("他吃完了饭，然后出门买了些东西回来。日子就这样过去。", 6),
    );
    expect(extractCommitments(samples)).toHaveLength(0);
  });
});

describe("M3 · 聚合摘要", () => {
  it("代表句偏长偏完整，不取碎片", () => {
    const sent = pickRepresentativeSentence(
      "他放下杯子。因为想起了一件事，他终于决定离开这里去找那个人问个清楚。",
    );
    expect(sent.length).toBeGreaterThan(8);
  });

  it("timelineDigest 按章序拼接且标注章号", () => {
    const samples = sampleChapters(repeat(SAMPLE, 5));
    const digest = buildTimelineDigest(samples);
    expect(digest).toContain("第1章");
    expect(digest.split("\n").length).toBeGreaterThan(1);
  });

  it("storylineDigest 比 timeline 更短（只留大事件）", () => {
    const calm = repeat("他吃了饭，然后出门买了些东西回来。日子就这样过去。", 20);
    const calmSamples = sampleChapters(calm);
    expect(buildStorylineDigest(calmSamples)).toBe("");
    // timeline 无论如何都有内容
    expect(buildTimelineDigest(calmSamples).length).toBeGreaterThan(0);
  });
});

describe("M3 · 统一入口", () => {
  it("extractAssets 一次产出三类资产 + 两条摘要", () => {
    const assets = extractAssets(repeat(SAMPLE, 12));
    expect(assets.characters.length).toBeGreaterThan(0);
    expect(assets.lore.length).toBeGreaterThan(0);
    expect(assets.commitments.length).toBeGreaterThan(0);
    expect(assets.timelineDigest.length).toBeGreaterThan(0);
    expect(assets.sampledChapters).toBe(12);
    expect(assets.sampledWords).toBeGreaterThan(0);
  });

  it("空章集不炸，返回全空资产", () => {
    const assets = extractAssets([]);
    expect(assets.characters).toEqual([]);
    expect(assets.lore).toEqual([]);
    expect(assets.commitments).toEqual([]);
    expect(assets.timelineDigest).toBe("");
  });

  it("summarizeAssets 计数一致且 top 不超上限", () => {
    const assets = extractAssets(repeat(SAMPLE, 12));
    const prev = summarizeAssets(assets, 3);
    expect(prev.characters.total).toBe(assets.characters.length);
    expect(prev.characters.top.length).toBeLessThanOrEqual(3);
    expect(prev.commitments.total).toBe(assets.commitments.length);
    expect(prev.digests.timelineChars).toBe(assets.timelineDigest.length);
  });
});

describe("M3 · 只有姓氏频次证据的候选被拒", () => {
  it("贪婪切分碎片（林川握/云宗）不进角色表", () => {
    // 无对话标签、无称谓，只靠姓氏频次——这类必须全拒
    const text = Array(12)
      .fill(0)
      .map(() => "林川握着青锋剑，站在青云宗的山门前。云宗弟子纷纷行礼，他恍若未闻。")
      .join("\n");
    const chars = extractCharacters(sampleChapters(repeat(text, 1)), { minMentions: 3 });
    for (const bad of ["林川握", "云宗"]) {
      expect(chars.map((c) => c.name)).not.toContain(bad);
    }
    // 每一条留下的都必须有硬证据
    for (const c of chars) {
      expect(
        c.evidence.includes("speech") || c.evidence.includes("honorific"),
      ).toBe(true);
    }
  });

  it("有对话标签的正常角色仍能进", () => {
    const chars = extractCharacters(sampleChapters(repeat(SAMPLE, 8)), { minMentions: 3 });
    expect(chars.map((c) => c.name)).toContain("林川");
  });
});
