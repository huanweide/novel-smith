"use client";

/**
 * 主题切换器 —— 十三档 UI 风格（8 深 / 5 浅），各自独立配色，参考成熟产品：
 *   深：夜航（墨蓝紫·经典）/ 苍青（青绿）/ GitHub Dark / Dracula / Nord / Tokyo Night / Gruvbox / 柔和深夜（C·默认）
 *   浅：白昼（米白）/ Solarized Light（纸感米黄）/ Catppuccin Latte（冷白）/ 暖白纸稿（A）/ 简洁文档（B）
 *
 * 状态持久化在 localStorage('nf-theme')，根布局防闪烁脚本首屏渲染前读取并加好 class。
 *
 * v3.1.131 修复：菜单改用 React Portal 渲染到 document.body + fixed 定位，
 *   彻底脱离祖先 overflow / transform 裁剪（原 absolute top-full 被 `overflow-x-auto`
 *   的顶栏容器裁掉，表现为「点主题按钮没反应」）。
 * v3.1.132：主题由 3 档扩展到 10 档；菜单按深色/浅色分组 + 色点预览 + 超高可滚动；
 *   右键按钮仍可快速循环切换下一档。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/ui/icons";

type ThemeId =
  | "theme-dusk"   // 柔和深夜（深色主力）
  | "theme-paper"  // 暖白纸稿（浅色，默认）
  | "theme-dracula"; // 德古拉（深色 · 强个性）

type Group = "dark" | "light";

interface ThemeDef {
  id: ThemeId;
  name: string;
  desc: string;
  icon: IconName;
  group: Group;
  /** 色点：该主题的页面底色，直观区分各主题 */
  swatch: string;
  /** 同步 <meta name="theme-color"> */
  meta: string;
}

const THEMES: ThemeDef[] = [
  { id: "theme-paper", name: "暖白纸稿", desc: "暖米底 · 书稿感（默认）", icon: "sun", group: "light", swatch: "#F3EEE3", meta: "#F3EEE3" },
  { id: "theme-dusk", name: "柔和深夜", desc: "深炭灰 · 零发光", icon: "moon", group: "dark", swatch: "#15171D", meta: "#15171D" },
  { id: "theme-dracula", name: "德古拉", desc: "暗紫霓虹 · 强个性", icon: "moon", group: "dark", swatch: "#282A36", meta: "#282A36" },
];

const ALL_IDS: ThemeId[] = THEMES.map((t) => t.id);
const LIGHT_IDS = new Set<ThemeId>(["theme-paper"]);

function applyTheme(id: ThemeId) {
  const d = document.documentElement;
  // 基础明暗类（dark/light）也要先清掉，否则切主题时上一个 light 残留导致配色错乱
  for (const c of [...ALL_IDS, "dark", "light"]) d.classList.remove(c);
  d.classList.add(id);
  d.classList.add(LIGHT_IDS.has(id) ? "light" : "dark"); // 浅色/深色系各补基础 class，复用既有适配规则
  try {
    localStorage.setItem("nf-theme", id);
  } catch {
    /* 无痕模式可能禁用 localStorage，忽略即可 */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const def = THEMES.find((t) => t.id === id);
  if (meta && def) meta.setAttribute("content", def.meta);
}

function currentTheme(): ThemeId {
  const d = document.documentElement;
  const found = ALL_IDS.find((id) => d.classList.contains(id));
  if (found) return found;
  // 兜底：无具体主题 class 时归到默认（新访客由 layout 防闪烁脚本直接加 theme-paper）
  return "theme-paper";
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeId>("theme-dusk");
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
    const next = ALL_IDS[(ALL_IDS.indexOf(currentTheme()) + 1) % ALL_IDS.length];
    pick(next);
  }, [pick]);

  const cur = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  const renderItem = (t: ThemeDef) => (
    <button
      key={t.id}
      type="button"
      role="menuitemradio"
      aria-checked={t.id === theme}
      onClick={() => pick(t.id)}
      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
        t.id === theme
          ? "bg-[var(--nv-primary-soft)] text-[var(--nv-text-primary)]"
          : "text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
      }`}
    >
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-[var(--nv-border-3)]"
        style={{ background: t.swatch }}
        aria-hidden="true"
      />
      <span className="flex flex-col items-start leading-tight">
        <span>{t.name}</span>
        <span className="text-[10px] opacity-60">{t.desc}</span>
      </span>
      {t.id === theme && <span className="ml-auto opacity-70">✓</span>}
    </button>
  );

  const menu =
    mounted && open ? (
      <div
        ref={menuRef}
        role="menu"
        aria-label="选择界面风格"
        style={{ position: "fixed", top: pos.top, right: pos.right }}
        className="z-[120] max-h-[24rem] w-[13rem] overflow-y-auto rounded-xl border border-[var(--nv-border-3)] bg-[var(--nv-surface-3)] p-1 shadow-xl backdrop-blur-sm"
      >
        <div className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wider opacity-45">深色</div>
        {THEMES.filter((t) => t.group === "dark").map(renderItem)}
        <div className="mt-1 border-t border-[var(--nv-border-2)] px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-wider opacity-45">
          浅色
        </div>
        {THEMES.filter((t) => t.group === "light").map(renderItem)}
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
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] text-[var(--nv-text-primary)] font-medium hover:border-[var(--nv-border-3)] transition-all duration-300 active:scale-[0.97] px-2.5 py-1.5"
        >
          <Icon name={cur.icon} size={15} />
          <span className="text-xs font-medium whitespace-nowrap">{cur.name}</span>
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  );
}
