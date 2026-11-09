import { describe, expect, it } from "vitest";
import {
  cnNumberIncrement,
  incrementChapterTitle,
  isPlaceholderChapterTitle,
  rebuildChapterTitle,
  toCnNumber,
} from "./chapter-title";

describe("toCnNumber / cnNumberIncrement", () => {
  it("中文数字转换与进位", () => {
    expect(toCnNumber(4)).toBe("四");
    expect(toCnNumber(10)).toBe("十");
    expect(toCnNumber(15)).toBe("十五");
    expect(toCnNumber(20)).toBe("二十");
    expect(toCnNumber(23)).toBe("二十三");
    expect(toCnNumber(105)).toBe("一百零五");
  });

  it("章号递增：中文、阿拉伯、进位", () => {
    expect(cnNumberIncrement("三")).toBe("四");
    expect(cnNumberIncrement("十九")).toBe("二十");
    expect(cnNumberIncrement("3")).toBe("4");
  });
});

describe("incrementChapterTitle（continue 新章标题）", () => {
  it("【M3 判别】带描述的中文章号：新章只给纯占位，不继承旧描述", () => {
    expect(incrementChapterTitle("第三章：雨夜追踪", 10)).toBe("第四章");
  });

  it("【M3 判别】纯占位中文章号：递增后仍是纯占位", () => {
    expect(incrementChapterTitle("第三章", 10)).toBe("第四章");
  });

  it("带前缀（卷一 第三章）保留前缀、去描述", () => {
    expect(incrementChapterTitle("卷一 第三章：雨夜追踪", 10)).toBe("卷一 第四章");
  });

  it("阿拉伯章号递增", () => {
    expect(incrementChapterTitle("第3章", 10)).toBe("第4章");
  });

  it("数字结尾标题递增", () => {
    expect(incrementChapterTitle("雨夜追踪 2", 10)).toBe("雨夜追踪 3");
  });

  it("无章号标题退化为（续）", () => {
    expect(incrementChapterTitle("雨夜追踪", 10)).toBe("雨夜追踪（续）");
  });

  it("空标题退化为第N节占位", () => {
    expect(incrementChapterTitle("", 5)).toBe("第5节");
  });
});

describe("isPlaceholderChapterTitle（自动命名回填守卫）", () => {
  it("【M3 判别】中文数字占位也算占位（旧正则只认阿拉伯，导致中文占位永远拿不到自动命名）", () => {
    expect(isPlaceholderChapterTitle("第四章")).toBe(true);
  });

  it("阿拉伯占位（既有行为回归守卫）", () => {
    expect(isPlaceholderChapterTitle("第4章")).toBe(true);
    expect(isPlaceholderChapterTitle("第 4 章")).toBe(true);
  });

  it("带卷号前缀的占位", () => {
    expect(isPlaceholderChapterTitle("卷一 第四章")).toBe(true);
    expect(isPlaceholderChapterTitle("卷2 第15章")).toBe(true);
  });

  it("带描述的标题不是占位（保护用户自定义标题）", () => {
    expect(isPlaceholderChapterTitle("第四章：雨夜追踪")).toBe(false);
    expect(isPlaceholderChapterTitle("雨夜追踪")).toBe(false);
    expect(isPlaceholderChapterTitle("第四章：")).toBe(false);
  });

  it("空标题是占位", () => {
    expect(isPlaceholderChapterTitle("")).toBe(true);
    expect(isPlaceholderChapterTitle("   ")).toBe(true);
  });
});

describe("rebuildChapterTitle（占位回填，继承风格）", () => {
  it("中文风格占位回填中文章号", () => {
    expect(rebuildChapterTitle("第四章", 4, "雨夜追踪")).toBe("第四章：雨夜追踪");
  });

  it("阿拉伯风格占位回填阿拉伯章号（风格不突变）", () => {
    expect(rebuildChapterTitle("第4章", 4, "新的一天")).toBe("第4章：新的一天");
  });

  it("带卷号前缀的占位回填保留前缀", () => {
    expect(rebuildChapterTitle("卷一 第四章", 4, "变故")).toBe("卷一 第四章：变故");
  });

  it("节类型占位保留节类型（不被改成章）", () => {
    expect(rebuildChapterTitle("第三节", 3, "重逢")).toBe("第三节：重逢");
  });

  it("无法解析时退回默认章格式", () => {
    expect(rebuildChapterTitle("", 7, "命名")).toBe("第7章：命名");
  });
});
