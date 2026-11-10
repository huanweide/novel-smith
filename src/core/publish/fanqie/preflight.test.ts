import { describe, it, expect } from "vitest";
import { preflightChapter, preflightChapters } from "./preflight";
import { FANQIE_MIN_WORDS } from "./types";

/** 造一段"像人写的"干净正文：段落短、有对话、无 AI 套话、不重复开头 */
function buildCleanContent(paragraphs = 14): string {
  const pool = [
    "雨点砸在瓦上，声音密得像有人往屋顶倒豆子。",
    "老周把烟按灭在鞋底，抬眼看了看巷口。",
    "「船家，今夜还过江吗？」他把斗笠往下压了压。",
    "对方没应声，只把缆绳在木桩上多绕了两圈。",
    "风从江面推过来，带着一股子腥气。",
    "沈砚蹲在棚子下，手指在膝头敲了三下，停住。",
    "远处有人在喊魂，声音忽远忽近，听不真切。",
    "「你要真急，就往上游走三里，那儿有渡。」船家终于开口。",
    "他道了谢，起身时膝盖响了一声。",
    "巷子里的狗叫了半声，又把脑袋埋回前爪中间。",
    "泥地上一串脚印，深浅不一，一直通到水边。",
    "沈砚数了数，一共七步，最后一步踩得很重。",
    "「有人在等他。」他心里冒出这个念头，随即压了下去。",
    "天边裂开一道白，雨小了。",
  ];
  const out: string[] = [];
  for (let i = 0; i < paragraphs; i++) out.push(pool[i % pool.length]);
  // 补一段长叙事把字数堆到门槛之上（每段短句拼接，不会触发 AI 词）
  let extra = "";
  while (extra.replace(/\s+/g, "").length < 900) {
    extra += "他沿水边走了几步，鞋底陷进泥里，拔出来时带起一小股水。";
  }
  out.push(extra);
  return out.join("\n\n");
}

describe("番茄发布体检", () => {
  it("字数不足 1000 是硬拦截（block），不允许发布", () => {
    const r = preflightChapter({
      title: "第1章 渡口",
      content: "雨点砸在瓦上。老周把烟按灭在鞋底。",
      chapterOrder: 1,
    });
    const words = r.items.find((i) => i.id === "words")!;
    expect(words.level).toBe("block");
    expect(words.pass).toBe(false);
    expect(r.pass).toBe(false);
    expect(r.stats.words).toBeLessThan(FANQIE_MIN_WORDS);
  });

  it("干净稿（字数达标、段落短、有对话）通过体检", () => {
    const content = buildCleanContent();
    const r = preflightChapter({ title: "第1章 渡口", content, chapterOrder: 1 });
    const words = r.items.find((i) => i.id === "words")!;
    const para = r.items.find((i) => i.id === "paragraph")!;
    expect(words.pass).toBe(true);
    expect(words.level).not.toBe("block");
    expect(para.pass).toBe(true);
    expect(r.pass).toBe(true);
  });

  it("长段落超三成会给出 warn 与可执行建议（不是空话）", () => {
    const longPara = "他沿着江岸一直往前走，走了很久很久。".repeat(20);
    const content = [longPara, longPara, longPara, "「走吧。」"].join("\n\n");
    const r = preflightChapter({ title: "第2章 江岸", content, chapterOrder: 2 });
    const para = r.items.find((i) => i.id === "paragraph")!;
    expect(para.level).toBe("warn");
    expect(para.hint).toBeTruthy();
  });

  it("通篇无对话会提示「闷」——番茄重对话推进", () => {
    const content = buildCleanContent().replace(/[「」]/g, "");
    const r = preflightChapter({ title: "第3章 独行", content, chapterOrder: 3 });
    const dialogue = r.items.find((i) => i.id === "dialogue")!;
    expect(dialogue.level).toBe("warn");
    expect(dialogue.detail).toContain("对话占比");
  });

  it("AI 痕迹过重会 block（复用本地规则引擎，带证据）", () => {
    const aiFlavored = [
      "值得一提的是，他的嘴角勾起一抹淡淡的弧度，仿佛一切尽在掌握之中。",
      "这不是退缩，而是蓄势；不是懦弱，而是隐忍；不是结束，而是开始。",
      "空气中弥漫着一丝若有若无的寒意，令人不由得心生敬畏。",
      "他缓缓抬起头，目光深邃而坚定，仿佛穿透了无尽的黑暗。",
      "总而言之，这一切都显得那么恰到好处，那么浑然天成。",
      "在这个瞬间，时间仿佛静止了，一切都变得格外清晰。",
    ]
      .join("\n\n")
      .repeat(6);
    const r = preflightChapter({ title: "第4章 玄机", content: aiFlavored, chapterOrder: 4 });
    const ai = r.items.find((i) => i.id === "aiTrace")!;
    expect(ai.level).toBe("block");
    expect(r.pass).toBe(false);
    expect(ai.detail).toMatch(/AI 痕迹 \d+\/100/);
    // 通篇同一种套话：分数可能不高，但每千字命中密度必须报警
    expect(r.stats.hitsPerK).toBeGreaterThanOrEqual(18);
  });

  it("质量分随问题扣分，干净稿明显高于问题稿", () => {
    const clean = preflightChapter({ title: "第1章 渡口", content: buildCleanContent(), chapterOrder: 1 });
    const bad = preflightChapter({ title: "第1章", content: "太短了。", chapterOrder: 1 });
    expect(clean.score).toBeGreaterThan(bad.score);
  });
});

describe("批量体检（工作台与发布台共用同一判据）", () => {
  const nodes = [
    { id: "n2", order: 1, title: "第二章", content: buildCleanContent() },
    { id: "n1", order: 0, title: "第一章", content: buildCleanContent() },
    { id: "empty", order: 2, title: "空章", content: "   " },
  ];

  it("按 order 排序、跳过空章、章节号从 1 连续编号", () => {
    const rows = preflightChapters(nodes);
    expect(rows.map((r) => r.nodeId)).toEqual(["n1", "n2"]);
    expect(rows.map((r) => r.chapterOrder)).toEqual([1, 2]);
    expect(rows[0].title).toBe("第1章 第一章");
  });

  it("默认不返回正文（避免整本书正文塞进诊断响应）", () => {
    const rows = preflightChapters(nodes);
    expect(rows[0].content).toBeUndefined();
    expect(rows[0].wordCount).toBeGreaterThan(0);
  });

  it("显式要求时才带排版后的正文", () => {
    const rows = preflightChapters(nodes, { withContent: true });
    expect(rows[0].content).toBeTruthy();
    expect(rows[0].content).toContain("\n");
  });

  it("同一份内容，批量与单章结论一致（不会两处判据打架）", () => {
    // 批量内部会先按番茄排版再体检，所以对拍也要用排版后的正文
    const rows = preflightChapters(nodes, { withContent: true });
    const single = preflightChapter({
      title: rows[0].title,
      content: rows[0].content!,
      chapterOrder: 1,
    });
    expect(rows[0].preflight.pass).toBe(single.pass);
    expect(rows[0].preflight.score).toBe(single.score);
  });
});
