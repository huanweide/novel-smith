"use client";

/**
 * 主题切换器 —— 三档 UI 风格：夜航（暗色·默认）/ 白昼（浅色）/ 苍青（青绿深色）。
 *
 * 状态持久化在 localStorage('nf-theme')，根布局防闪烁脚本会在首屏渲染前
 * 读取该值并加好 class，因此切换不会造成白屏闪烁。
 *
 * v3.1.131 修复：下拉菜单原为 `absolute top-full`，而挂载点之一（首页顶栏）的父容器
 * 带 `overflow-x-auto` —— 该属性会把 overflow-y 一并计算为 auto，于是菜单被容器裁掉，
 * 表现为「点主题按钮没反应、无法切换」。现改用 React Portal 把菜单渲染到
 * document.body 并用 fixed 定位，彻底脱离任何祖先 overflow / transform 裁剪。
 * 同步增强点击交互：右键按钮快速循环下一档、Esc 关闭、滚动/缩放自动跟随定位。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/ui/icons";

type ThemeId = "dark" | "light" | "azure";

const THEMES: { id: ThemeId; name: string; desc: string; icon: IconName }[] = [
  { id: "dark", name: "夜航", desc: "虚空暗色 · 默认", icon: "moon" },
  { id: "light", name: "白昼", desc: "浅色 · 日光", icon: "sun" },
  { id: "azure", name: "苍青", desc: "青绿深色 · 新风格", icon: "sparkles" },
];
const THEME_ORDER: ThemeId[] = ["dark", "light", "azure"];

function applyTheme(id: ThemeId) {
  const d = document.documentElement;
  d.classList.remove("light", "dark", "azure");
  if (id === "light") d.classList.add("light");
  else if (id === "azure") { d.classList.add("azure"); d.classList.add("dark"); } // 苍青=深色风格，保留 dark: 变体
  else d.classList.add("dark");
  try {
    localStorage.setItem("nf-theme", id);
  } catch {
    /* 无痕模式可能禁用 localStorage，忽略即可 */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", id === "light" ? "#EEF0F4" : id === "azure" ? "#04090C" : "#4f46e5");
  }
}

function currentTheme(): ThemeId {
  const d = document.documentElement;
  if (d.classList.contains("light")) return "light";
  if (d.classList.contains("azure")) return "azure";
  return "dark";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setTheme(currentTheme());
  }, []);

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  // 打开时定位，并让菜单跟随滚动 / 窗口缩放
  useEffect(() => {
    if (!open) return;
    place();
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = useCallback((id: ThemeId) => {
    applyTheme(id);
    setTheme(id);
    setOpen(false);
  }, []);

  // 右键 = 直接循环到下一档（更快的切换方式）
  const cycle = useCallback(() => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(currentTheme()) + 1) % THEME_ORDER.length];
    pick(next);
  }, [pick]);

  const cur = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  const menu =
    mounted && open ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label="选择界面风格"
        style={{ position: "fixed", top: pos.top, right: pos.right }}
        className="z-[120] min-w-[11rem] rounded-xl border border-[var(--nv-border-3)] bg-[var(--nv-surface-3)] p-1 shadow-xl backdrop-blur-sm"
      >
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="menuitemradio"
            aria-checked={t.id === theme}
            onClick={() => pick(t.id)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${
              t.id === theme
                ? "bg-[var(--nv-primary-soft)] text-[var(--nv-text-primary)]"
                : "text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
            }`}
          >
            <Icon name={t.icon} size={14} />
            <span className="flex flex-col items-start leading-tight">
              <span>{t.name}</span>
              <span className="text-[10px] opacity-60">{t.desc}</span>
            </span>
            {t.id === theme && <span className="ml-auto opacity-70">✓</span>}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <>
      <div className={`relative inline-flex ${className}`}>
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          onContextMenu={(e) => {
            e.preventDefault();
            cycle();
          }}
          aria-label="切换界面风格"
          aria-haspopup="menu"
          aria-expanded={open}
          title={`界面风格：${cur.name}（${cur.desc}）· 右键快速切换下一档`}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] hover:border-[var(--nv-border-3)] transition-all duration-300 active:scale-[0.97] px-2.5 py-1.5"
        >
          <Icon name={cur.icon} size={15} />
          <span className="text-xs font-medium">{cur.name}</span>
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
