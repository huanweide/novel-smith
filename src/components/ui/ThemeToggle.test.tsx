// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

/**
 * v3.1.131：主题切换器下拉菜单原为 `absolute top-full`，而首页顶栏的父容器带
 * `overflow-x-auto`（会把 overflow-y 一并算成 auto）→ 菜单被容器裁掉，表现为
 * 「点『夜航』没反应、无法切换主题」。现改用 React Portal 渲染到 document.body +
 * fixed 定位，彻底脱离祖先裁剪。
 *
 * 这里把两条关键不变量钉死为回归守卫：
 *   1) 菜单必须挂在 document.body 下、且【不在】组件自身容器内（否则一旦父级有
 *      overflow/transform 又会被裁）；
 *   2) 选中主题后 html class 与 localStorage('nf-theme') 必须真实生效。
 */

const themeButton = () => screen.getByRole("button", { name: "切换界面风格" });
const bodyMenu = () => document.body.querySelector('[role="menu"]');
const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));

describe("v3.1.131 ThemeToggle 菜单脱离容器裁剪", () => {
  beforeEach(() => {
    document.documentElement.className = "dark";
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("默认渲染当前主题按钮；未点击时不渲染菜单", () => {
    const { container } = render(<ThemeToggle />);
    expect(themeButton()).toBeTruthy();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(bodyMenu()).toBeNull();
  });

  it("点击后菜单渲染在 document.body 下，且不在组件容器内（防 overflow 裁剪）", () => {
    const { container } = render(<ThemeToggle />);
    fireEvent.click(themeButton());
    expect(bodyMenu()).not.toBeNull();
    // 关键不变量：菜单已脱离组件容器
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.contains(bodyMenu())).toBe(true);
  });

  it("选择「白昼」后 html 加 light class 并写入 localStorage", () => {
    render(<ThemeToggle />);
    fireEvent.click(themeButton());
    const white = menuItems().find((b) => b.textContent?.includes("白昼"));
    expect(white).toBeTruthy();
    fireEvent.click(white!);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("nf-theme")).toBe("light");
    // 选择后菜单关闭
    expect(bodyMenu()).toBeNull();
  });

  it("Esc 关闭菜单", () => {
    render(<ThemeToggle />);
    fireEvent.click(themeButton());
    expect(bodyMenu()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(bodyMenu()).toBeNull();
  });

  it("右键按钮直接循环到下一档（夜航 → 白昼）", () => {
    render(<ThemeToggle />);
    fireEvent.contextMenu(themeButton());
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("nf-theme")).toBe("light");
  });
});
