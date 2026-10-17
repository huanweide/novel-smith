// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DetectorPanel } from "./DetectorPanel";

/**
 * DetectorPanel 的行为固化（v3.1.138 起）。
 *
 * 这里只测「纯本地交互」，不测检测算法本身（那在 core/humanize 有 100+ 条用例）。
 * 关注点是 v3.1.138 新增的两个转化设计：
 *   1. 一键套用后出现「套用前 X 分 → 现在 Y 分」的对比条（即时成就反馈）
 *   2. 撤销回原点后对比条消失（基线快照随之失效）
 */

/** 页面内置的样本文本：注释里写明必须 >200 字且同时含删除类与替换类可机改项 */
function loadSample() {
  fireEvent.click(screen.getByText("载入示例"));
}

describe("DetectorPanel —— 套用前后对比（v3.1.138）", () => {
  it("刚载入示例时没有对比条（还没发生任何套用）", () => {
    render(<DetectorPanel />);
    loadSample();
    expect(screen.queryByText(/套用前/)).toBeNull();
  });

  it("一键套用后出现对比条，且显示降分", () => {
    render(<DetectorPanel />);
    loadSample();
    fireEvent.click(screen.getByText(/一键套用 \d+ 处/));
    const bar = screen.getByText(/套用前 \d+ 分/);
    expect(bar).toBeTruthy();
    // 对比条里必须出现「现在」与下降分数，缺一项这个反馈就是残废的
    expect(screen.getByText(/现在 \d+ 分/)).toBeTruthy();
    expect(screen.getByText(/↓ \d+ 分/)).toBeTruthy();
  });

  it("撤销回原点后对比条消失", () => {
    render(<DetectorPanel />);
    loadSample();
    fireEvent.click(screen.getByText(/一键套用 \d+ 处/));
    expect(screen.queryByText(/套用前 \d+ 分/)).toBeTruthy();
    // 撤销到栈空：回到了「来的时候」，基线快照失效
    fireEvent.click(screen.getByText("撤销"));
    expect(screen.queryByText(/套用前 \d+ 分/)).toBeNull();
  });

  it("footer 引导不再把「配 Key」当第一步，而是先说不配 Key 能干什么", () => {
    render(<DetectorPanel />);
    const footer = screen.getByText(/不需要 Key/);
    expect(footer).toBeTruthy();
    // 必须出现完整的「不配 Key 也能用」能力列举，而不是一句「去配 Key」
    expect(screen.getByText(/边写边检测/)).toBeTruthy();
    expect(screen.getByText(/伏笔追踪/)).toBeTruthy();
  });
});
