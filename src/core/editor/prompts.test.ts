/**
 * 模拟编辑审稿 —— 纯逻辑层单测（不联网、不调 LLM、不碰 DB）
 *
 * 锁死：
 * 1. getRoleSystem：预设角色注入人设+平台口味；custom 走兜底；严禁机械套路词。
 * 2. buildReviewUserPrompt：章节以【章N】标记，且带 JSON 输出规范。
 * 3. parseReviewJson：能脱掉 ```json 围栏；能把 chapterRef 映射回 nodeId/title；畸形 JSON 不崩。
 * 4. buildPromptForTune：按章节分组，输出可直接粘进「微调指令」框。
 * 5. buildApplyUserPrompt：含现有正文与修改意见，约束「只改指定处、不重写全文」。
 */
import { describe, it, expect } from "vitest";
import {
  getRoleSystem,
  buildReviewUserPrompt,
  parseReviewJson,
  buildPromptForTune,
  buildApplyUserPrompt,
  buildLocatePrompt,
  parseLocateJson,
  applyPatches,
  type ReviewChapterInput,
} from "./prompts";

const chapters: ReviewChapterInput[] = [
  { ref: "章1", nodeId: "node-a", title: "第1章 觉醒", content: "夜色中，他睁开了眼。" },
  { ref: "章2", nodeId: "node-b", title: "第2章 抉择", content: "前路两难，他必须选一个。" },
];

describe("getRoleSystem", () => {
  it("番茄角色注入人设与平台口味，且不含机械套路词", () => {
    const sys = getRoleSystem("fanqie", "fanqie");
    expect(sys).toContain("番茄小说");
    expect(sys).toContain("前 3 屏");
    // 不机械：明确禁止套公式/硬塞固定桥段
    expect(sys).toContain("不要套公式");
    expect(sys).toContain("装逼打脸");
  });

  it("不同平台口味不同（起点强调长期钩子）", () => {
    const qidian = getRoleSystem("qidian", "qidian");
    expect(qidian).toContain("起点中文网");
    expect(qidian).toContain("追更");
  });

  it("custom 走兜底人设，不依赖预设", () => {
    const sys = getRoleSystem("custom", "general");
    expect(sys).toContain("资深网文编辑");
    expect(sys).not.toContain("番茄小说");
  });
});

describe("buildReviewUserPrompt", () => {
  it("章节以【章N】标记，且要求严格 JSON 输出", () => {
    const p = buildReviewUserPrompt(chapters);
    expect(p).toContain("【章1】");
    expect(p).toContain("【章2】");
    expect(p).toContain("第1章 觉醒");
    expect(p).toContain('"suggestions"');
    expect(p).toContain("rewriteHint");
  });
});

describe("parseReviewJson", () => {
  it("脱掉 ```json 围栏并映射 chapterRef 到 nodeId/title", () => {
    const raw = '```json\n' + JSON.stringify({
      overall: "整体不错",
      verdict: "可投但需打磨",
      dimensions: [{ key: "hook", label: "开头钩子", score: 70, comment: "可以" }],
      suggestions: [
        { chapterRef: "章1", location: "开头第1段", issue: "太慢", severity: "high", suggestion: "加快节奏", rewriteHint: "删掉环境描写" },
      ],
    }) + "\n```";
    const r = parseReviewJson(raw, chapters);
    expect(r.overall).toBe("整体不错");
    expect(r.verdict).toBe("可投但需打磨");
    expect(r.dimensions).toHaveLength(1);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].nodeId).toBe("node-a");
    expect(r.suggestions[0].chapterTitle).toBe("第1章 觉醒");
  });

  it("未包裹围栏的裸 JSON 也能解析", () => {
    const raw = JSON.stringify({ overall: "ok", verdict: "签约潜力高", dimensions: [], suggestions: [] });
    const r = parseReviewJson(raw, chapters);
    expect(r.overall).toBe("ok");
    expect(r.suggestions).toHaveLength(0);
  });

  it("畸形 JSON 不崩溃，返回空结构", () => {
    const r = parseReviewJson("完全不是json{{{{", chapters);
    expect(r.overall).toBe("");
    expect(Array.isArray(r.dimensions)).toBe(true);
    expect(Array.isArray(r.suggestions)).toBe(true);
  });

  it("severity 非法值归并为 medium", () => {
    const raw = JSON.stringify({
      overall: "x", verdict: "x", dimensions: [],
      suggestions: [{ chapterRef: "章2", severity: "urgent", suggestion: "改" }],
    });
    const r = parseReviewJson(raw, chapters);
    expect(r.suggestions[0].severity).toBe("medium");
    expect(r.suggestions[0].nodeId).toBe("node-b");
  });
});

describe("buildPromptForTune", () => {
  it("按章节分组并带微调指令", () => {
    const tune = buildPromptForTune([
      { nodeId: "node-a", chapterTitle: "第1章 觉醒", chapterRef: "章1", location: "开头", issue: "慢", severity: "high", suggestion: "加速", rewriteHint: "删环境描写" },
      { nodeId: "node-a", chapterTitle: "第1章 觉醒", chapterRef: "章1", location: "中段", issue: "平", severity: "medium", suggestion: "加冲突", rewriteHint: "插入对立" },
    ]);
    expect(tune).toContain("【第1章 觉醒】");
    expect(tune).toContain("微调指令：删环境描写");
    expect(tune).toContain("微调指令：插入对立");
    expect(tune).toContain("保持原文文风");
  });

  it("无建议返回空串", () => {
    expect(buildPromptForTune([])).toBe("");
  });
});

describe("buildApplyUserPrompt", () => {
  it("包含现有正文与修改意见，并约束只改指定处", () => {
    const p = buildApplyUserPrompt("原文内容", [
      { location: "第2段", issue: "拖沓", suggestion: "精简", rewriteHint: "合并两句" },
    ]);
    expect(p).toContain("原文内容");
    expect(p).toContain("第2段");
    expect(p).toContain("合并两句");
    expect(p).toContain("不要重写全文");
    expect(p).toContain("完整章节正文");
  });
});

describe("buildLocatePrompt", () => {
  it("要求模型给原文锚点 + 替换片段，且明令禁止重写全文", () => {
    const p = buildLocatePrompt("正文内容", [{ location: "第2段", issue: "拖沓", suggestion: "精简" }]);
    expect(p).toContain("正文内容");
    expect(p).toContain("第2段");
    expect(p).toContain('"patches"');
    expect(p).toContain("anchor");
    expect(p).toContain("逐字完全一致");
    expect(p).toContain("严禁重写全文");
  });
});

describe("parseLocateJson", () => {
  it("脱掉围栏并解析出 patches", () => {
    const raw =
      "```json\n" +
      JSON.stringify({ patches: [{ anchor: "原文片段", replacement: "新文本" }] }) +
      "\n```";
    const patches = parseLocateJson(raw);
    expect(patches).toHaveLength(1);
    expect(patches[0].anchor).toBe("原文片段");
    expect(patches[0].replacement).toBe("新文本");
  });

  it("畸形 JSON 返回空数组（由调用方回退整章改写）", () => {
    expect(parseLocateJson("不是json")).toEqual([]);
    expect(parseLocateJson("")).toEqual([]);
  });

  it("过滤掉 anchor 为空的无效补丁", () => {
    const raw = JSON.stringify({
      patches: [{ anchor: "  ", replacement: "x" }, { anchor: "有效", replacement: "y" }],
    });
    expect(parseLocateJson(raw)).toHaveLength(1);
  });
});

describe("applyPatches", () => {
  it("单处替换：只改锚点那一段，其余一字不动", () => {
    const src = "开头内容。中间要改的这段很长。结尾内容。";
    const r = applyPatches(src, [{ anchor: "中间要改的这段很长", replacement: "改好了" }]);
    expect(r.hit).toBe(1);
    expect(r.total).toBe(1);
    expect(r.content).toBe("开头内容。改好了。结尾内容。");
  });

  it("多处替换：倒序应用，索引不错位，两处都改到", () => {
    const src = "AAAA BBBB CCCC";
    const r = applyPatches(src, [
      { anchor: "AAAA", replacement: "1111" },
      { anchor: "CCCC", replacement: "3333" },
    ]);
    expect(r.hit).toBe(2);
    expect(r.content).toBe("1111 BBBB 3333");
  });

  it("锚点未命中：记录 missed 且不改动正文", () => {
    const src = "原文不动";
    const r = applyPatches(src, [{ anchor: "压根不存在的片段", replacement: "x" }]);
    expect(r.hit).toBe(0);
    expect(r.total).toBe(1);
    expect(r.missed).toHaveLength(1);
    expect(r.content).toBe(src);
  });

  it("部分命中：命中的改，没命中的保留", () => {
    const src = "AAA 中间 BBB";
    const r = applyPatches(src, [
      { anchor: "AAA", replacement: "111" },
      { anchor: "不存在", replacement: "222" },
    ]);
    expect(r.hit).toBe(1);
    expect(r.missed).toHaveLength(1);
    expect(r.content).toBe("111 中间 BBB");
  });

  it("空补丁列表：原样返回", () => {
    const src = "什么都不改";
    const r = applyPatches(src, []);
    expect(r.hit).toBe(0);
    expect(r.content).toBe(src);
  });
});
