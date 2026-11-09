// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CompareModeModal } from "./CompareModeModal";

/**
 * v3.1.133 对比模式：左右并排展示「原有内容 / 新生成内容」，由作者选择保留哪一边。
 * 这里钉死三件事：① 未打开不渲染；② 两侧都带字数元信息；③ 两个保留按钮分别回传正确的 side。
 */
const OLD = "原有正文第一段。\n\n原有正文第二段。";
const NEW = "新生成正文第一段。\n\n新生成正文第二段。\n\n新生成正文第三段。";

function setup(overrides: Partial<Parameters<typeof CompareModeModal>[0]> = {}) {
  const onKeep = vi.fn();
  const onClose = vi.fn();
  render(
    <CompareModeModal
      open
      originalContent={OLD}
      newContent={NEW}
      modeLabel="正文生成"
      onKeep={onKeep}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onKeep, onClose };
}

describe("v3.1.133 CompareModeModal 左右对比选择", () => {
  it("open=false 时不渲染任何内容", () => {
    const { container } = render(
      <CompareModeModal open={false} originalContent={OLD} newContent={NEW} onKeep={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("左右两栏都渲染，且带各自字数与段落数", () => {
    setup();
    const original = screen.getByRole("button", { name: "选择原有内容" });
    const next = screen.getByRole("button", { name: "选择新生成内容" });
    expect(original.textContent).toContain("原有内容");
    expect(next.textContent).toContain("新生成内容");
    // 元信息形如「N 字 · M 段」
    expect(original.textContent).toMatch(/\d+ 字 · \d+ 段/);
    expect(next.textContent).toMatch(/\d+ 字 · \d+ 段/);
  });

  it("点击左栏后该栏被选中（aria-pressed=true），右栏未选中", () => {
    setup();
    const original = screen.getByRole("button", { name: "选择原有内容" });
    const next = screen.getByRole("button", { name: "选择新生成内容" });
    fireEvent.click(original);
    expect(original.getAttribute("aria-pressed")).toBe("true");
    expect(next.getAttribute("aria-pressed")).toBe("false");
  });

  it("点「保留原有内容」回传 original", () => {
    const { onKeep } = setup();
    fireEvent.click(screen.getByRole("button", { name: /保留原有内容/ }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledWith("original");
  });

  it("点「保留新生成内容」回传 new", () => {
    const { onKeep } = setup();
    fireEvent.click(screen.getByRole("button", { name: /保留新生成内容/ }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onKeep).toHaveBeenCalledWith("new");
  });

  it("busy 时保留按钮禁用，防止重复提交", () => {
    setup({ busy: true });
    const btn = screen.getByRole("button", { name: /保留原有内容/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
