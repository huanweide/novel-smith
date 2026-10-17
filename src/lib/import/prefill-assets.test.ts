import { describe, it, expect } from "vitest";
import { sanitizeCharFill, pMap } from "./prefill-assets";

/**
 * M4 预填的纯函数测试（不调 LLM）。
 *
 * 重点不是「LLM 会返回什么」，而是「不管它返回什么，
 * 脏数据能不能被挡住」——这些规则一旦被改松，
 * 编出来的角色卡就会 approved 进每一次生成的上下文。
 */

describe("M4 · sanitizeCharFill 占位文本拦截", () => {
  it("「未知」「待补充」这类占位不算信息", () => {
    const { data, filled } = sanitizeCharFill({
      age: "未知",
      gender: "待补充",
      background: "不详",
    });
    expect(data.age).toBeUndefined();
    expect(data.gender).toBeUndefined();
    expect(data.background).toBeUndefined();
    expect(filled).toHaveLength(0);
  });

  it("空字符串 / null / 非字符串一律丢掉", () => {
    const { data } = sanitizeCharFill({
      age: "  ",
      // 故意传脏类型：类型上 gender/storyLine 是 string，运行时给数字/空
      gender: 42 as unknown as string,
      storyLine: (null as unknown) as string,
    });
    expect(Object.keys(data)).toHaveLength(0);
  });
});

describe("M4 · sanitizeCharFill 值域校验", () => {
  it("非法 role 被丢弃，不入库", () => {
    const { data } = sanitizeCharFill({ role: "protagonist" });
    expect(data.role).toBe("protagonist");
    const bad = sanitizeCharFill({ role: "supervisor" });
    expect(bad.data.role).toBeUndefined();
  });

  it("非法 currentStatus 被丢弃", () => {
    expect(sanitizeCharFill({ currentStatus: "zombie" }).data.currentStatus).toBeUndefined();
    expect(sanitizeCharFill({ currentStatus: "dead" }).data.currentStatus).toBe("dead");
  });

  it("数组字段过滤非字符串并限长 12", () => {
    const { data } = sanitizeCharFill({
      aliases: ["林川", 42, null, "", "  ", "阿川", ...Array(20).fill("x")],
    });
    const arr = data.aliases as string[];
    expect(arr).toContain("林川");
    expect(arr).toContain("阿川");
    expect(arr.every((x) => typeof x === "string" && x.length > 0)).toBe(true);
    expect(arr.length).toBeLessThanOrEqual(12);
  });

  it("数组里的占位文本也被滤", () => {
    const { data } = sanitizeCharFill({ abilities: ["未知", "剑术"] });
    expect(data.abilities).toEqual(["剑术"]);
  });
});

describe("M4 · sanitizeCharFill 性格结构化", () => {
  it("五要素拆进 personality 对象", () => {
    const { data, filled } = sanitizeCharFill({
      dominant: "外冷内热",
      drive: "找回父亲",
      contradiction: "嘴上狠心手上救人",
      habits: ["习惯性敲桌子", "独处时才卸防"],
      socialMask: "对谁都客客气气",
    });
    const p = data.personality as Record<string, unknown>;
    expect(p.dominant).toBe("外冷内热");
    expect(p.drive).toBe("找回父亲");
    expect(p.contradiction).toBe("嘴上狠心手上救人");
    expect(p.habits).toHaveLength(2);
    expect(p.socialMask).toBe("对谁都客客气气");
    expect(filled).toContain("性格");
  });

  it("五要素全空时不出 personality 键", () => {
    const { data } = sanitizeCharFill({
      dominant: "",
      drive: "  ",
      contradiction: "未知",
      habits: [],
    });
    expect(data.personality).toBeUndefined();
  });

  it("部分要素也能落（不要求五项齐全）", () => {
    const { data } = sanitizeCharFill({ dominant: "沉默寡言" });
    expect((data.personality as Record<string, unknown>).dominant).toBe("沉默寡言");
  });
});

describe("M4 · 长度上限", () => {
  it("超长背景被截到 2000 字（防上下文被一张卡撑爆）", () => {
    const { data } = sanitizeCharFill({ background: "啊".repeat(5000) });
    expect((data.background as string).length).toBe(2000);
  });

  it("性格习惯限 8 条", () => {
    const { data } = sanitizeCharFill({
      habits: Array(30).fill("习惯"),
    });
    expect(((data.personality as Record<string, unknown>).habits as string[]).length).toBe(8);
  });
});

describe("M4 · pMap 并发闸", () => {
  it("并发上限真的生效，且不丢结果", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await pMap(items, 4, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(out).toHaveLength(20);
    // 顺序必须与输入一致（靠游标，不用 Promise.all 收集）
    expect(out[0]).toBe(0);
    expect(out[19]).toBe(38);
  });

  it("空数组不炸", async () => {
    expect(await pMap([], 4, async (n) => n)).toEqual([]);
  });
});
