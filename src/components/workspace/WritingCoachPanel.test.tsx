// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WritingCoachPanel } from "./WritingCoachPanel";

describe("WritingCoachPanel - 实时写作教练面板", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("空正文显示引导空状态，不渲染分数", () => {
    render(<WritingCoachPanel content="" characterNames={[]} />);
    expect(screen.getByText(/开始写作后/)).toBeTruthy();
    expect(screen.queryByLabelText(/综合质量分/)).toBeNull();
  });

  it("有正文时防抖（300ms）后才出分数与维度，不在首帧即时渲染", () => {
    render(
      <WritingCoachPanel
        content="他握剑刺出。敌人应声倒下。她转身离去。"
        characterNames={["他", "她"]}
      />,
    );
    // 防抖前不应立即出分数（避免每次按键都同步重算卡顿）
    expect(screen.queryByLabelText(/综合质量分/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByLabelText(/综合质量分/)).toBeTruthy();
    expect(screen.getByText("废词率")).toBeTruthy();
    // 教练建议区存在（六维各有一条「在测：」，用 getAll 避免多匹配报错）
    expect(screen.getAllByText(/在测：/).length).toBeGreaterThan(0);
  });

  it("正文清空后报告应被清除（回到引导态）", () => {
    const { rerender } = render(
      <WritingCoachPanel content="张三走向门口。李四坐在桌前。" characterNames={["张三", "李四"]} />,
    );
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByLabelText(/综合质量分/)).toBeTruthy();
    rerender(<WritingCoachPanel content="" characterNames={[]} />);
    expect(screen.queryByLabelText(/综合质量分/)).toBeNull();
    expect(screen.getByText(/开始写作后/)).toBeTruthy();
  });
});
