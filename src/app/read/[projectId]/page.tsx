"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { toastError } from "@/components/ui/toast";
import { Loading, EmptyState } from "@/components/ui/States";
import { MarkdownViewer } from "@/components/workspace/MarkdownViewer";
import {
  clampFontSize,
  computeReadingProgress,
  neighborIndices,
} from "@/lib/reader-utils";

interface TocItem {
  id: string;
  order: number;
  title: string;
  words: number;
}
interface ProjectMeta {
  id: string;
  name: string;
}

const FS_KEY = "novel-smith-reader-fs";

export default function ReadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  const [projectName, setProjectName] = useState("");
  const [toc, setToc] = useState<TocItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadingToc, setLoadingToc] = useState(true);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [progress, setProgress] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── 字号：从 localStorage 恢复 ──
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(FS_KEY));
      if (Number.isFinite(v)) setFontSize(clampFontSize(v));
    } catch { /* 忽略 */ }
  }, []);
  const changeFont = useCallback(
    (delta: number) => {
      setFontSize((prev) => {
        const next = clampFontSize(prev + delta);
        try { localStorage.setItem(FS_KEY, String(next)); } catch { /* 忽略 */ }
        return next;
      });
    },
    [],
  );

  // ── 拉目录 + 项目名 ──
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      setLoadingToc(true);
      setLoadError(null);
      try {
        const [tocRes, projRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/chapters`),
          fetch("/api/projects"),
        ]);
        if (!tocRes.ok) {
          if (tocRes.status === 404) { setLoadError("项目不存在"); return; }
          setLoadError("目录加载失败");
          return;
        }
        const tocData = (await tocRes.json()) as { chapters?: TocItem[] };
        const list = tocData.chapters ?? [];
        if (!alive) return;
        setToc(list);
        if (projRes.ok) {
          const projs = (await projRes.json()) as ProjectMeta[];
          const mine = projs.find((p) => p.id === projectId);
          if (mine) setProjectName(mine.name);
        }
        if (list.length > 0) setCurrentId(list[0].id);
        else setLoadError(null);
      } catch {
        if (alive) setLoadError("网络异常，目录加载失败");
      } finally {
        if (alive) setLoadingToc(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // ── 拉当前章正文 ──
  useEffect(() => {
    if (!currentId) return;
    let alive = true;
    (async () => {
      setLoadingChapter(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/story/nodes/${currentId}`);
        if (!res.ok) { if (alive) setLoadError("章节加载失败"); return; }
        const node = (await res.json()) as { content?: string };
        if (!alive) return;
        setContent(node.content ?? "");
        // 切章回到顶部
        scrollRef.current?.scrollTo({ top: 0 });
        setProgress(0);
      } catch {
        if (alive) setLoadError("网络异常，章节加载失败");
      } finally {
        if (alive) setLoadingChapter(false);
      }
    })();
    return () => { alive = false; };
  }, [currentId]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setProgress(computeReadingProgress(el.scrollTop, el.scrollHeight, el.clientHeight));
  }, []);

  const ids = toc.map((t) => t.id);
  const { prev, next } = neighborIndices(ids, currentId);
  const currentTitle = toc.find((t) => t.id === currentId)?.title ?? "";

  const selectChapter = (id: string) => {
    setCurrentId(id);
    setTocOpen(false);
  };

  const TocList = (
    <div className="flex flex-col">
      <div className="px-4 py-3 text-xs font-semibold tracking-widest text-[var(--nv-text-secondary)] border-b border-[var(--nv-border-2)]">
        目录
      </div>
      <div className="overflow-y-auto">
        {toc.length === 0 ? (
          <p className="px-4 py-6 text-xs text-[var(--nv-text-tertiary)]">还没有可阅读的正文章节。</p>
        ) : (
          toc.map((t) => (
            <button
              key={t.id}
              onClick={() => selectChapter(t.id)}
              className={`w-full text-left px-4 py-2.5 text-sm border-b border-[var(--nv-border-2)]/60 transition-colors ${
                t.id === currentId
                  ? "bg-[var(--nv-primary-soft)] text-[var(--nv-primary)] font-medium"
                  : "text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)]"
              }`}
            >
              <span className="block truncate">{t.title}</span>
              <span className="text-[10px] text-[var(--nv-text-muted)]">{t.words} 字</span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--nv-void)] text-[var(--nv-text-primary)]">
      {/* 阅读进度条 */}
      <div className="h-0.5 w-full bg-[var(--nv-surface-2)] shrink-0">
        <div
          className="h-full bg-[var(--nv-primary)] transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* 顶栏 */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-[var(--nv-border-2)] shrink-0">
        <button
          onClick={() => setTocOpen(true)}
          className="lg:hidden btn-ghost text-xs px-2 py-1.5 rounded-lg flex items-center gap-1"
          aria-label="打开目录"
        >
          <Icon name="menu" size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] text-[var(--nv-text-muted)] truncate">{projectName || "阅读模式"}</div>
          <div className="text-sm font-medium truncate">{currentTitle || "未选择章节"}</div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => changeFont(-1)}
            className="btn-ghost w-8 h-8 rounded-lg text-base font-semibold"
            aria-label="缩小字号"
            title="缩小字号"
          >
            A−
          </button>
          <span className="text-[10px] text-[var(--nv-text-muted)] w-7 text-center">{fontSize}</span>
          <button
            onClick={() => changeFont(1)}
            className="btn-ghost w-8 h-8 rounded-lg text-base font-semibold"
            aria-label="放大字号"
            title="放大字号"
          >
            A+
          </button>
          <Link
            href={`/workspace/${projectId}`}
            className="btn-ghost text-xs px-2 py-1.5 rounded-lg flex items-center gap-1 ml-1"
            title="回到写作台"
          >
            <Icon name="pencil" size={14} /> 写作
          </Link>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 桌面侧栏目录 */}
        <aside className="hidden lg:block w-72 border-r border-[var(--nv-border-2)] overflow-hidden shrink-0">
          {TocList}
        </aside>

        {/* 阅读区 */}
        <main ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-5 py-8 md:py-10">
            {loadingToc ? (
              <div className="py-20"><Loading label="正在载入目录…" /></div>
            ) : loadError && toc.length === 0 ? (
              <EmptyState
                icon="book"
                title={loadError}
                description="请确认项目 id 是否正确，或先到写作台写几章正文。"
                className="surface-elevated border-solid border-[var(--nv-border-2)] mt-10"
              />
            ) : toc.length === 0 ? (
              <EmptyState
                icon="book"
                title="这本书还没有正文"
                description="去写作台写下一章，再回来这里慢慢读。"
                className="surface-elevated border-solid border-[var(--nv-border-2)] mt-10"
              />
            ) : loadingChapter ? (
              <div className="py-20"><Loading label="正在载入章节…" /></div>
            ) : (
              <article
                className="reader-scope"
                style={{ ["--reader-fs" as string]: `${fontSize}px` } as React.CSSProperties}
              >
                <MarkdownViewer content={content} projectId={projectId} />
              </article>
            )}
          </div>
        </main>
      </div>

      {/* 底栏：上一章 / 下一章 */}
      <footer className="flex border-t border-[var(--nv-border-2)] shrink-0">
        <button
          disabled={prev < 0}
          onClick={() => prev >= 0 && selectChapter(ids[prev])}
          className="flex-1 py-3 text-sm flex items-center justify-center gap-1 text-[var(--nv-text-secondary)] disabled:opacity-30 hover:bg-[var(--nv-surface-2)]"
        >
          <Icon name="chevronRight" size={14} className="rotate-180" /> 上一章
        </button>
        <div className="w-px bg-[var(--nv-border-2)]" />
        <button
          disabled={next < 0}
          onClick={() => next >= 0 && selectChapter(ids[next])}
          className="flex-1 py-3 text-sm flex items-center justify-center gap-1 text-[var(--nv-text-secondary)] disabled:opacity-30 hover:bg-[var(--nv-surface-2)]"
        >
          下一章 <Icon name="chevronRight" size={14} />
        </button>
      </footer>

      {/* 移动端目录抽屉 */}
      {tocOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setTocOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-[80vw] bg-[var(--nv-void)] border-r border-[var(--nv-border-2)] z-50 lg:hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--nv-border-2)]">
              <span className="text-sm font-semibold">目录</span>
              <button onClick={() => setTocOpen(false)} className="btn-ghost px-2 py-1 rounded-lg" aria-label="关闭目录">
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{TocList}</div>
          </div>
        </>
      )}
    </div>
  );
}
