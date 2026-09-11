import { describe, it, expect } from "vitest";
import { maskKey, maskLlmConfig } from "@/lib/llm-config-mask";

describe("maskKey", () => {
  it("长 key 中间打码只留末 4 位", () => {
    expect(maskKey("sk-abcdefghijklmnop").endsWith("mnop")).toBe(true);
    expect(maskKey("sk-abcdefghijklmnop").startsWith("sk-")).toBe(false);
  });
  it("短于等于 4 位的 key 整体打码（非空返回 ****，空返回空串）", () => {
    expect(maskKey("abc")).toBe("****");
    expect(maskKey("")).toBe("");
    expect(maskKey(null as unknown as string)).toBe("");
  });
});

describe("maskLlmConfig", () => {
  it("含明文 apiKey 时脱敏并附加 hasApiKey", () => {
    const out = maskLlmConfig({ apiKey: "sk-secret12345", model: "x" });
    expect(out?.apiKey).not.toBe("sk-secret12345");
    expect((out?.apiKey as string).endsWith("2345")).toBe(true);
    expect(out?.hasApiKey).toBe(true);
    expect((out as Record<string, unknown>).model).toBe("x");
  });
  it("null / undefined 原样返回", () => {
    expect(maskLlmConfig(null)).toBeNull();
    expect(maskLlmConfig(undefined)).toBeNull();
  });
  it("空对象 {} 仍返回对象且 hasApiKey 为 false", () => {
    const out = maskLlmConfig({});
    expect(out).not.toBeNull();
    expect(out?.hasApiKey).toBe(false);
  });
  it("非对象（字符串等）原样返回", () => {
    expect(maskLlmConfig("plain")).toBe("plain");
  });
});
