import { describe, expect, it } from "vitest";
import {
  avatarFileHash,
  composePortraitPrompt,
  extractImageFromResponse,
  parseImageUpload,
  PORTRAIT_SIZE,
} from "./avatar";

describe("头像文件名：确定性哈希", () => {
  it("同名同哈希、异名异哈希、空名兜底", () => {
    expect(avatarFileHash("林舟")).toBe(avatarFileHash("林舟"));
    expect(avatarFileHash("林舟")).not.toBe(avatarFileHash("陆昭"));
    expect(avatarFileHash("")).toBe(avatarFileHash("unnamed"));
  });

  it("哈希是 8 位十六进制（文件名安全）", () => {
    for (const n of ["林舟", "店小二", "王铁匠·殁"]) {
      expect(avatarFileHash(n)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("立绘提示词：档案里已有什么就拼什么", () => {
  it("空档案只有名字", () => {
    const p = composePortraitPrompt({ name: "陆昭" });
    expect(p).toContain("陆昭");
    expect(p).toContain("人物立绘插画");
  });

  it("外貌为主、身份点睛、性格气质、世界观画风", () => {
    const p = composePortraitPrompt(
      {
        name: "王铁匠",
        role: "铁匠",
        appearance: "虎口老茧厚实，膀阔腰圆，一脸风霜",
        personality: "执拗",
      },
      "市井武侠世界"
    );
    expect(p).toContain("虎口老茧厚实");
    expect(p).toContain("王铁匠，铁匠");
    expect(p).toContain("气质执拗");
    expect(p).toContain("市井武侠世界");
  });

  it("档案太空时背景顶上（不给模型一句空话）", () => {
    const p = composePortraitPrompt({ name: "无名", background: "曾是宫廷剑客，因罪流亡" });
    expect(p).toContain("宫廷剑客");
  });

  it("立绘尺寸是竖版", () => {
    expect(PORTRAIT_SIZE).toBe("768x1024");
  });
});

describe("导入图片校验：字节说了算，不看扩展名", () => {
  it("接受 dataURL 包装的 PNG", () => {
    const png1x1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const r = parseImageUpload(`data:image/png;base64,${png1x1}`);
    expect(r).toMatchObject({ ok: true, mime: "png" });
  });

  it("接受裸 base64 的 JPEG；拒绝非图片字节", () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
    expect(parseImageUpload(jpg)).toMatchObject({ ok: true, mime: "jpeg" });
    const txt = Buffer.from("这不是图片，是一段文字").toString("base64");
    expect(parseImageUpload(txt).ok).toBe(false);
  });

  it("空数据 / 空字节 / 超 4MB 都拒", () => {
    expect(parseImageUpload("").ok).toBe(false);
    const big = Buffer.alloc(4 * 1024 * 1024 + 1, 0x89).toString("base64");
    expect(parseImageUpload(big).ok).toBe(false);
  });
});

describe("生图响应解析：OpenAI 与 SiliconFlow 两种风格都认", () => {
  it("OpenAI 风格 data[0].url", () => {
    expect(extractImageFromResponse({ data: [{ url: "https://cdn/x.png" }] })).toMatchObject({ ok: true, url: "https://cdn/x.png" });
  });

  it("OpenAI 风格 data[0].b64_json", () => {
    expect(extractImageFromResponse({ data: [{ b64_json: "aGk=" }] })).toMatchObject({ ok: true, b64: "aGk=" });
  });

  it("SiliconFlow 风格 images[0].url", () => {
    expect(extractImageFromResponse({ images: [{ url: "https://cdn/y.png" }] })).toMatchObject({ ok: true, url: "https://cdn/y.png" });
  });

  it("两样都没有 → 如实报错，不编造", () => {
    expect(extractImageFromResponse({}).ok).toBe(false);
    expect(extractImageFromResponse(null).ok).toBe(false);
    expect(extractImageFromResponse({ data: [{}] }).ok).toBe(false);
  });
});
