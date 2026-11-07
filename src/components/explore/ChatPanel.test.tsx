// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";
import type { ExploreMessage, AdoptCard } from "@/core/explore/types";

// jsdom 没有 scrollIntoView，ChatPanel 挂载/消息变化时会调用
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const card = (id: string, title: string): AdoptCard => ({
  id,
  title,
  content: "具体可用的设定描述，超过二十个字以避免被当成空话过滤。",
  step: "opening",
});

function setup(messages: ExploreMessage[], overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const props = {
    messages,
    loading: false,
    mode: "chat" as const,
    currentStep: "opening" as const,
    adoptStatus: {},
    aiConfigured: true,
    onSend: vi.fn(),
    onStepChange: vi.fn(),
    onModeChange: vi.fn(),
    onAdoptCard: vi.fn(),
    onReroll: vi.fn(),
    ...overrides,
  };
  render(<ChatPanel {...props} />);
  return props;
}

describe("ChatPanel - 探讨对话面板", () => {
  it("stepIntro 消息渲染为居中步骤分隔芯片，不渲染普通气泡", () => {
    const messages: ExploreMessage[] = [
      { role: "user", content: "我想写都市异能" },
      { role: "agent", content: "说说你关于世界观的想法？", stepIntro: "worldview" },
    ];
    setup(messages);
    expect(screen.getByText(/继续讨论 · 世界观/)).toBeTruthy();
    // 芯片消息不应再渲染「AI 创作顾问」气泡昵称
    expect(screen.queryByText("AI 创作顾问")).toBeNull();
  });

  it("最后一条 AI 回复带卡片时显示「换一批」，点击展开提示词输入并可重摇", () => {
    const onReroll = vi.fn();
    const messages: ExploreMessage[] = [
      { role: "user", content: "定个方向" },
      { role: "agent", content: "三个方向：", cards: [card("c1", "深夜异单系统"), card("c2", "巷脉行者"), card("c3", "算法即神")] },
    ];
    setup(messages, { onReroll });

    const rerollBtn = screen.getByText("换一批");
    fireEvent.click(rerollBtn);
    // 展开提示词输入
    const hintInput = screen.getByPlaceholderText(/重摇提示/) as HTMLInputElement;
    fireEvent.change(hintInput, { target: { value: "要更黑暗的方向" } });
    fireEvent.click(screen.getByText("换一批", { selector: "button" }));
    expect(onReroll).toHaveBeenCalledWith("要更黑暗的方向");
  });

  it("无提示词直接确认 → onReroll 收到 undefined", () => {
    const onReroll = vi.fn();
    const messages: ExploreMessage[] = [
      { role: "agent", content: "三个方向：", cards: [card("c1", "A"), card("c2", "B"), card("c3", "C")] },
    ];
    setup(messages, { onReroll });
    fireEvent.click(screen.getByText("换一批"));
    // 展开后出现两个「换一批」按钮（确认按钮与外层按钮同名），选带确认语义的第二个
    const buttons = screen.getAllByText("换一批");
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onReroll).toHaveBeenCalledWith(undefined);
  });

  it("最后一条消息无卡片时不显示「换一批」", () => {
    const messages: ExploreMessage[] = [{ role: "agent", content: "纯文字回复" }];
    setup(messages);
    expect(screen.queryByText("换一批")).toBeNull();
  });

  it("卡片带步骤徽标（如「开篇」）", () => {
    const messages: ExploreMessage[] = [
      { role: "agent", content: "三个方向：", cards: [card("c1", "深夜异单系统"), card("c2", "B"), card("c3", "C")] },
    ];
    setup(messages);
    expect(screen.getByText("深夜异单系统")).toBeTruthy();
    // 徽标文本出现（卡片 step 标签）
    expect(screen.getAllByText("开篇").length).toBeGreaterThan(0);
  });
});
