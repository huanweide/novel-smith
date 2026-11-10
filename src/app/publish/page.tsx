"use client";

/**
 * 番茄发布台（个人验证版）
 *
 * 一句话：把 novel-smith 里写完的章节，按平台规矩体检、排版、排期，再发到番茄。
 *
 * 设计原则（与 core/publish/fanqie 保持一致，改代码前先读）：
 *   ① 质量先过关再谈发布——体检 block 的章节根本进不了发布队列；
 *   ② 行为像正常作者——日更上限硬顶 3 章、时段窗口内抖动、从存稿池取稿；
 *   ③ 凭据只在本机——Cookie 加密入库，界面只显示脱敏提示；
 *   ④ 平台改版是常态——探测/DOM 检查按钮就在手边，不让人对着黑箱猜。
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { hhmmToMinutes, minutesToHHMM } from "@/core/publish/fanqie/types";

interface Account {
  id: string;
  label: string;
  connected: boolean;
  cookieHint: string | null;
  credentialUpdatedAt: string | null;
  bookId: string | null;
  bookTitle: string | null;
  channel: "api" | "cdp" | "auto";
  cdpEndpoint: string;
  autoMode: "confirm" | "auto";
  dailyLimit: number;
  windowStartMin: number;
  windowEndMin: number;
  dailyHardCap: number;
}

interface PreflightItem {
  id: string;
  label: string;
  level: "block" | "warn" | "ok";
  pass: boolean;
  detail: string;
  hint?: string;
}
interface Preflight {
  pass: boolean;
  score: number;
  items: PreflightItem[];
  stats: {
    words: number;
    paragraphs: number;
    avgParagraphChars: number;
    dialogueRatio: number;
    aiScore: number;
    hitsPerK: number;
  };
}

interface Task {
  id: string;
  chapterOrder: number;
  chapterTitle: string;
  wordCount: number;
  status: "held" | "scheduled" | "filling" | "published" | "failed" | "canceled";
  scheduledAt: string | null;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
  channel: string | null;
  preflight: Preflight | null;
  nodeId: string | null;
}

interface LogRow {
  id: string;
  level: string;
  message: string;
  detail: string | null;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  name: string;
}
interface ChapterRow {
  id: string;
  order: number;
  title: string;
  words: number;
}

const STATUS_LABEL: Record<Task["status"], string> = {
  held: "待确认",
  scheduled: "已排期",
  filling: "发布中",
  published: "已发布",
  failed: "失败",
  canceled: "已取消",
};
const STATUS_CLS: Record<Task["status"], string> = {
  held: "bg-[var(--nv-surface-3)] text-[var(--nv-text-secondary)]",
  scheduled: "bg-[var(--nv-primary)]/15 text-[var(--nv-primary)]",
  filling: "bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]",
  published: "bg-emerald-500/15 text-emerald-600",
  failed: "bg-red-500/15 text-red-600",
  canceled: "bg-[var(--nv-surface-3)] text-[var(--nv-text-muted)]",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PublishPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-xs text-[var(--nv-text-tertiary)]">加载发布台…</div>}>
      <PublishInner />
    </Suspense>
  );
}

function PublishInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState<Account | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string>("");

  // 账号表单（本地编辑，点保存才提交）
  const [cookie, setCookie] = useState("");
  const [csrf, setCsrf] = useState("");
  const [bookId, setBookId] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [channel, setChannel] = useState<Account["channel"]>("auto");
  const [cdpEndpoint, setCdpEndpoint] = useState("http://127.0.0.1:9222");
  const [autoMode, setAutoMode] = useState<Account["autoMode"]>("confirm");
  const [dailyLimit, setDailyLimit] = useState(2);
  const [winStart, setWinStart] = useState("08:00");
  const [winEnd, setWinEnd] = useState("09:00");

  // 排期参数
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [perDay, setPerDay] = useState(1);
  /** 存稿池每章的番茄体检结果（与工作台「发布与过检」同源，nodeId → 结果） */
  const [chapterHealth, setChapterHealth] = useState<Record<string, { pass: boolean; score: number }>>({});

  const [probe, setProbe] = useState<{ ok: boolean; status: number; sample: string; error?: string } | null>(null);
  const [cdpInfo, setCdpInfo] = useState<{ ok: boolean; page?: { title: string; url: string }; editorReady?: boolean; error?: string } | null>(null);
  const [domDump, setDomDump] = useState<any>(null);

  const loadAccount = useCallback(async () => {
    try {
      const r = await fetch("/api/publish/fanqie/account");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "加载账号失败");
      const a = d.account as Account;
      setAccount(a);
      setBookId(a.bookId || "");
      setBookTitle(a.bookTitle || "");
      setChannel(a.channel);
      setCdpEndpoint(a.cdpEndpoint);
      setAutoMode(a.autoMode);
      setDailyLimit(a.dailyLimit);
      setWinStart(minutesToHHMM(a.windowStartMin));
      setWinEnd(minutesToHHMM(a.windowEndMin));
    } catch (e: any) {
      toastError(e.message || "加载账号失败");
    }
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/publish/fanqie/tasks?limit=120");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "加载任务失败");
      setTasks(d.tasks || []);
    } catch {
      /* 静默：任务列表失败不该打断主流程 */
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch("/api/publish/fanqie/logs?limit=40");
      const d = await r.json();
      if (r.ok) setLogs(d.logs || []);
    } catch {
      /* 同上 */
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/projects");
      const d = await r.json();
      const list = (d.projects || d.items || d || []) as any[];
      if (Array.isArray(list)) {
        setProjects(list.map((p) => ({ id: p.id, name: p.name || p.title || "未命名" })));
        if (!projectId && list[0]) setProjectId(list[0].id);
      }
    } catch {
      /* 项目列表失败时下面的下拉为空，用户能看出问题 */
    }
  }, [projectId]);

  useEffect(() => {
    // 支持从工作台「发布与过检」带 ?projectId= 跳进来，直接定位到那本书
    const fromQuery = searchParams.get("projectId");
    if (fromQuery) setProjectId(fromQuery);
  }, [searchParams]);

  useEffect(() => {
    void loadAccount();
    void loadTasks();
    void loadLogs();
    void loadProjects();
  }, [loadAccount, loadTasks, loadLogs, loadProjects]);

  const loadChapters = useCallback(async (pid: string) => {
    if (!pid) {
      setChapters([]);
      setChapterHealth({});
      return;
    }
    try {
      const r = await fetch(`/api/projects/${pid}/chapters`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "读取章节失败");
      const list = (d.chapters || [])
        .filter((c: any) => c.words > 0)
        .map((c: any) => ({ id: c.id, order: c.order, title: c.title, words: c.words }));
      setChapters(list);

      // 复用工作台同一份体检（publish-check），避免两处判据不一致
      try {
        const pr = await fetch(`/api/projects/${pid}/publish-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform: "fanqie" }),
        });
        const pd = await pr.json();
        if (pr.ok && Array.isArray(pd?.preflight)) {
          const map: Record<string, { pass: boolean; score: number }> = {};
          for (const row of pd.preflight) {
            map[row.nodeId] = { pass: !!row.preflight?.pass, score: row.preflight?.score ?? 0 };
          }
          setChapterHealth(map);
        }
      } catch {
        /* 体检失败不影响入队：入队时后端还会再算一次 */
      }
    } catch (e: any) {
      toastError(e.message || "读取章节失败");
      setChapters([]);
      setChapterHealth({});
    }
  }, []);

  useEffect(() => {
    setPicked(new Set());
    void loadChapters(projectId);
  }, [projectId, loadChapters]);

  // 已入队的 nodeId：章节列表里打勾标注，避免重复入队
  const enqueuedNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) if (t.nodeId && t.status !== "canceled") s.add(t.nodeId);
    return s;
  }, [tasks]);

  const post = async (path: string, body: any) => {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "请求失败");
    return d;
  };

  const saveConnect = async () => {
    if (!cookie.trim()) return toastError("先粘贴 Cookie");
    setBusy("connect");
    try {
      await post("/api/publish/fanqie/account", { action: "connect", cookie: cookie.trim(), csrfToken: csrf.trim() });
      setCookie("");
      setCsrf("");
      toastSuccess("已加密保存；建议立刻点「探测接口」确认登录态有效");
      void loadAccount();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const saveConfig = async () => {
    setBusy("config");
    try {
      await post("/api/publish/fanqie/account", {
        action: "update",
        bookId,
        bookTitle,
        channel,
        cdpEndpoint,
        autoMode,
        dailyLimit,
        windowStartMin: hhmmToMinutes(winStart) ?? 480,
        windowEndMin: hhmmToMinutes(winEnd) ?? 540,
      });
      toastSuccess("配置已保存");
      void loadAccount();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const doProbe = async () => {
    setBusy("probe");
    setProbe(null);
    try {
      const d = await post("/api/publish/fanqie/account", { action: "probe" });
      setProbe(d.probe);
      if (d.probe?.ok) toastSuccess(`接口通了（HTTP ${d.probe.status}）`);
      else toastError(d.probe?.error || `HTTP ${d.probe?.status}`);
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const doCdp = async () => {
    setBusy("cdp");
    try {
      const d = await post("/api/publish/fanqie/account", { action: "cdp" });
      setCdpInfo(d.cdp);
      if (d.cdp?.ok) toastSuccess(d.cdp.editorReady ? "浏览器通道就绪（编辑器已识别）" : "端口通了，但当前页不像编辑页");
      else toastError(d.cdp?.error || "浏览器通道不可用");
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const doInspect = async () => {
    setBusy("inspect");
    try {
      const d = await post("/api/publish/fanqie/account", { action: "inspect" });
      setDomDump(d.dom);
      toastSuccess("已把页面元素 dump 到下方，照着校准即可");
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const enqueueBatch = async (mode: "held" | "scheduled") => {
    if (!projectId) return toastError("先选项目");
    const ids = Array.from(picked);
    if (ids.length === 0) return toastError("先勾选要发的章节");
    setBusy("enqueue");
    try {
      const d = await post("/api/publish/fanqie/tasks", {
        action: "batch",
        projectId,
        nodeIds: ids,
        // 每日章数：待确认模式先按 1 排，确认后再放行
        perDay: mode === "scheduled" ? perDay : 1,
        startDate,
      });
      const blocked = (d.created || []).filter((c: any) => !c.pass).length;
      const warns = (d.warnings || []).join("；");
      if (mode === "scheduled" && (d.created || []).length > 0) {
        // 待确认模式入队后是 held；这里按用户选择把它们放行成 scheduled
        for (const c of d.created) {
          await fetch("/api/publish/fanqie/tasks", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: c.id, action: "release" }),
          });
        }
      }
      toastSuccess(
        `已入队 ${(d.created || []).length} 章${blocked ? `，其中 ${blocked} 章体检未过（会拦在发布前）` : ""}${warns ? `。${warns}` : ""}`,
      );
      setPicked(new Set());
      void loadTasks();
      void loadLogs();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const taskAction = async (id: string, action: "release" | "cancel" | "retry") => {
    setBusy(`task-${id}`);
    try {
      await fetch("/api/publish/fanqie/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await fetch("/api/publish/fanqie/tick", { method: "POST" });
      void loadTasks();
      void loadLogs();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const runTick = async () => {
    setBusy("tick");
    try {
      const d = await post("/api/publish/fanqie/tick", {});
      const r = d.result || {};
      toastSuccess(`执行完成：发布 ${r.published || 0}，失败 ${r.failed || 0}，跳过 ${r.skipped || 0}`);
      void loadTasks();
      void loadLogs();
    } catch (e: any) {
      toastError(e.message);
    } finally {
      setBusy("");
    }
  };

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[var(--nv-abyss)] pb-10">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/90 px-5 py-3 backdrop-blur">
        <Button onClick={() => router.push("/")} className="btn-ghost h-8 rounded-lg px-2.5 text-xs">
          <Icon name="arrowLeft" size={13} /> 返回
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold text-[var(--nv-text-primary)]">番茄发布台</h1>
          <p className="truncate text-[11px] text-[var(--nv-text-tertiary)]">
            本机个人验证 · 凭据加密只存本机 · 日更硬顶 {account?.dailyHardCap ?? 3} 章
          </p>
        </div>
        <Button onClick={runTick} disabled={busy === "tick"} className="btn-ghost h-8 rounded-lg px-3 text-xs">
          <Icon name="play" size={12} /> 立即执行一轮
        </Button>
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── 左：账号 + 存稿池 ── */}
        <div className="space-y-4">
          {/* 账号 */}
          <section className="rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nv-text-primary)]">
                <Icon name="key" size={14} className="text-[var(--nv-creative)]" /> 账号连接
              </h2>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] ${
                  account?.connected ? "bg-emerald-500/15 text-emerald-600" : "bg-[var(--nv-surface-3)] text-[var(--nv-text-muted)]"
                }`}
              >
                {account?.connected ? `已连接 ${account.cookieHint}` : "未连接"}
              </span>
            </div>

            <details className="mb-3 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 p-3 text-[11px] leading-5 text-[var(--nv-text-tertiary)]">
              <summary className="cursor-pointer text-xs text-[var(--nv-text-secondary)]">怎么拿到 Cookie 与 CSRF（点开）</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-4">
                <li>浏览器登录番茄作家后台 → 打开「作品管理」。</li>
                <li>按 F12 → Network（网络）→ 随便点一个 <code>/api/author/...</code> 请求。</li>
                <li>在 Request Headers 里复制整个 <code>cookie</code> 与 <code>x-secsdk-csrf-token</code>。</li>
                <li>粘贴到下面 → 保存 → 点「探测接口」看是否真的通了（HTTP 200 才算通）。</li>
              </ol>
              <p className="mt-2 text-[10px] text-[var(--nv-text-muted)]">
                Cookie 只加密保存在这台电脑的数据库里，界面永远不回显明文；失效后重新复制一次即可。
              </p>
            </details>

            <div className="space-y-2">
              <textarea
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                rows={3}
                placeholder="cookie（sessionid=...; passport_csrf_token=...; ...）"
                className="input-glass w-full rounded-lg px-3 py-2 font-mono text-[11px]"
              />
              <input
                value={csrf}
                onChange={(e) => setCsrf(e.target.value)}
                placeholder="x-secsdk-csrf-token"
                className="input-glass w-full rounded-lg px-3 py-2 font-mono text-[11px]"
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveConnect} disabled={busy === "connect"} className="btn-primary h-8 rounded-lg px-3 text-xs">
                  保存连接
                </Button>
                <Button onClick={doProbe} disabled={busy === "probe" || !account?.connected} className="btn-ghost h-8 rounded-lg px-3 text-xs">
                  探测接口
                </Button>
                <Button onClick={doCdp} disabled={busy === "cdp"} className="btn-ghost h-8 rounded-lg px-3 text-xs">
                  检测浏览器
                </Button>
                <Button onClick={doInspect} disabled={busy === "inspect"} className="btn-ghost h-8 rounded-lg px-3 text-xs">
                  检查页面元素
                </Button>
              </div>

              {probe && (
                <div className={`rounded-lg border p-2 text-[11px] ${probe.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <p className="text-[var(--nv-text-primary)]">接口探测：HTTP {probe.status} {probe.ok ? "· 通" : `· ${probe.error || "失败"}`}</p>
                  {probe.sample && <p className="mt-1 break-all font-mono text-[10px] text-[var(--nv-text-tertiary)]">{probe.sample}</p>}
                  {!probe.ok && (
                    <p className="mt-1 text-[10px] text-[var(--nv-text-muted)]">
                      端点来自社区惯例、未在你这台机器实测过。HTTP 404 就把下面的「发布路径」改成你 F12 里真实看到的地址；
                      或者把通道切到「浏览器」直接走 CDP，不依赖接口。
                    </p>
                  )}
                </div>
              )}

              {cdpInfo && (
                <div className={`rounded-lg border p-2 text-[11px] ${cdpInfo.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
                  <p className="text-[var(--nv-text-primary)]">
                    浏览器通道：{cdpInfo.ok ? (cdpInfo.editorReady ? "就绪（已识别编辑器）" : "端口通了，当前页不像编辑页") : cdpInfo.error}
                  </p>
                  {cdpInfo.page && <p className="mt-1 truncate text-[10px] text-[var(--nv-text-tertiary)]">{cdpInfo.page.title} · {cdpInfo.page.url}</p>}
                </div>
              )}

              {domDump && (
                <details open className="rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 p-2 text-[10px]">
                  <summary className="cursor-pointer text-[11px] text-[var(--nv-text-secondary)]">页面元素 dump（用来校准选择器）</summary>
                  <div className="mt-2 max-h-56 overflow-auto font-mono leading-5 text-[var(--nv-text-tertiary)]">
                    <p className="text-[var(--nv-text-primary)]">可编辑元素：</p>
                    {(domDump.editables || []).map((e: any, i: number) => (
                      <p key={i}>· {e.selector} ({e.tag}{e.placeholder ? `, ${e.placeholder}` : ""})</p>
                    ))}
                    <p className="mt-2 text-[var(--nv-text-primary)]">按钮：</p>
                    {(domDump.buttons || []).slice(0, 20).map((b: any, i: number) => (
                      <p key={i}>· 「{b.text}」 {b.selector}</p>
                    ))}
                    <p className="mt-2 text-[var(--nv-text-primary)]">输入框：</p>
                    {(domDump.inputs || []).slice(0, 12).map((b: any, i: number) => (
                      <p key={i}>· {b.selector} ({b.type}{b.placeholder ? `, ${b.placeholder}` : ""})</p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          {/* 发布配置 */}
          <section className="rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--nv-text-primary)]">
              <Icon name="settings" size={14} className="text-[var(--nv-creative)]" /> 发布配置
            </h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                目标作品 bookId（白名单，防误发到别的书）
                <input value={bookId} onChange={(e) => setBookId(e.target.value)} placeholder="7xxxxxxxxxxxx" className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 font-mono text-[11px]" />
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                作品名（只用于界面识别）
                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="我的书" className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]" />
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                通道
                <select value={channel} onChange={(e) => setChannel(e.target.value as Account["channel"])} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]">
                  <option value="auto">自动（接口优先，失败降级浏览器）</option>
                  <option value="api">只走接口（快，需 Cookie）</option>
                  <option value="cdp">只走浏览器（稳，能处理弹窗）</option>
                </select>
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                浏览器调试地址
                <input value={cdpEndpoint} onChange={(e) => setCdpEndpoint(e.target.value)} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 font-mono text-[11px]" />
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                自动化边界
                <select value={autoMode} onChange={(e) => setAutoMode(e.target.value as Account["autoMode"])} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]">
                  <option value="confirm">发前必须我确认</option>
                  <option value="auto">到点自动发（受每日上限约束）</option>
                </select>
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                每日上限（硬顶 {account?.dailyHardCap ?? 3}）
                <input type="number" min={1} max={3} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]" />
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                更新时段起
                <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]" />
              </label>
              <label className="text-[11px] text-[var(--nv-text-tertiary)]">
                更新时段止
                <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} className="input-glass mt-1 w-full rounded-lg px-2.5 py-1.5 text-[11px]" />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-[10px] leading-4 text-[var(--nv-text-muted)]">
                时段内随机抖动 ±20 分钟。日更上限硬卡在 3 章——这是「别踩量产红线」的代码级保证，不是建议。
              </p>
              <Button onClick={saveConfig} disabled={busy === "config"} className="btn-primary h-8 shrink-0 rounded-lg px-3 text-xs">
                保存配置
              </Button>
            </div>
          </section>

          {/* 存稿池 */}
          <section className="rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nv-text-primary)]">
                <Icon name="book" size={14} className="text-[var(--nv-creative)]" /> 存稿池
              </h2>
              <div className="flex items-center gap-2">
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input-glass rounded-lg px-2 py-1 text-[11px]">
                  {projects.length === 0 && <option value="">（还没有项目）</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-[var(--nv-text-tertiary)]">
                  起始
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-glass rounded-lg px-2 py-1 text-[11px]" />
                </label>
                <label className="flex items-center gap-1 text-[11px] text-[var(--nv-text-tertiary)]">
                  每天
                  <input type="number" min={1} max={3} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="input-glass w-14 rounded-lg px-2 py-1 text-[11px]" />
                  章
                </label>
              </div>
            </div>

            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {chapters.length === 0 && (
                <p className="py-6 text-center text-[11px] italic text-[var(--nv-text-muted)]">
                  这个项目还没有带正文的章节——先去写作台写完再回来
                </p>
              )}
              {chapters.map((c) => {
                const done = enqueuedNodeIds.has(c.id);
                const health = chapterHealth[c.id];
                return (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                      done
                        ? "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/30 opacity-60"
                        : picked.has(c.id)
                          ? "border-[var(--nv-creative)]/50 bg-[var(--nv-creative-soft)]"
                          : "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 hover:border-[var(--nv-creative)]/40"
                    }`}
                  >
                    <input type="checkbox" checked={picked.has(c.id)} disabled={done} onChange={() => togglePick(c.id)} className="accent-[var(--nv-creative)]" />
                    <span className="min-w-0 flex-1 truncate text-[var(--nv-text-primary)]">{c.title}</span>
                    {health && (
                      <span
                        className={`shrink-0 rounded px-1 text-[10px] ${
                          health.pass ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
                        }`}
                        title={health.pass ? "体检通过（与工作台同一份判据）" : "体检有硬伤：入队后会被拦在发布前"}
                      >
                        体检 {health.score}
                      </span>
                    )}
                    <span className="shrink-0 text-[var(--nv-text-tertiary)]">{c.words} 字</span>
                    {done && <span className="shrink-0 rounded bg-[var(--nv-surface-3)] px-1.5 text-[10px] text-[var(--nv-text-muted)]">已入队</span>}
                  </label>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--nv-border-2)] pt-3">
              <p className="text-[10px] text-[var(--nv-text-muted)]">
                入队时会自动按番茄排版（段落≤120 字）并跑体检；体检不过的会被拦在发布前，不会发出去。
              </p>
              <div className="flex gap-2">
                <Button onClick={() => enqueueBatch("held")} disabled={busy === "enqueue" || picked.size === 0} className="btn-ghost h-8 rounded-lg px-3 text-xs">
                  入队待确认（{picked.size}）
                </Button>
                <Button onClick={() => enqueueBatch("scheduled")} disabled={busy === "enqueue" || picked.size === 0} className="btn-primary h-8 rounded-lg px-3 text-xs">
                  按排期自动发
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* ── 右：任务队列 + 日志 ── */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-[var(--nv-text-primary)]">
              <Icon name="clipboard" size={14} className="text-[var(--nv-creative)]" /> 发布队列
            </h2>
            {tasks.length === 0 && <p className="py-8 text-center text-[11px] italic text-[var(--nv-text-muted)]">队列是空的</p>}
            <div className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
              {tasks.map((t) => {
                const pf = t.preflight;
                const score = pf?.score ?? null;
                return (
                  <div key={t.id} className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--nv-text-primary)]">{t.chapterTitle}</span>
                      <span className="shrink-0 text-[10px] text-[var(--nv-text-tertiary)]">{t.wordCount} 字</span>
                      {score != null && (
                        <span
                          className={`shrink-0 rounded px-1.5 text-[10px] ${
                            pf?.pass ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
                          }`}
                          title={(pf?.items || []).map((i) => `${i.label}：${i.detail}`).join("\n")}
                        >
                          体检 {score}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-[var(--nv-text-tertiary)]">
                      <span>{t.status === "published" ? `已发 ${fmtTime(t.publishedAt)}` : `计划 ${fmtTime(t.scheduledAt)}`}</span>
                      {t.attempts > 0 && <span>· 尝试 {t.attempts} 次</span>}
                      {t.channel && <span>· {t.channel}</span>}
                      <span className="ml-auto flex gap-1">
                        {(t.status === "held" || t.status === "failed") && (
                          <button
                            onClick={() => taskAction(t.id, t.status === "failed" ? "retry" : "release")}
                            disabled={busy === `task-${t.id}`}
                            className="rounded border border-[var(--nv-border-2)] px-1.5 py-0.5 hover:border-[var(--nv-creative)]"
                          >
                            {t.status === "failed" ? "重试" : "立即发"}
                          </button>
                        )}
                        {(t.status === "held" || t.status === "scheduled" || t.status === "failed") && (
                          <button
                            onClick={() => taskAction(t.id, "cancel")}
                            disabled={busy === `task-${t.id}`}
                            className="rounded border border-[var(--nv-border-2)] px-1.5 py-0.5 hover:border-red-400"
                          >
                            取消
                          </button>
                        )}
                      </span>
                    </div>
                    {t.lastError && (
                      <p className="mt-1 line-clamp-2 rounded bg-red-500/5 px-1.5 py-1 text-[10px] text-red-600" title={t.lastError}>
                        {t.lastError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--nv-text-primary)]">
                <Icon name="file" size={14} className="text-[var(--nv-creative)]" /> 运行日志
              </h2>
              <button onClick={() => void loadLogs()} className="text-[10px] text-[var(--nv-text-tertiary)] underline decoration-dotted">
                刷新
              </button>
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto pr-1 font-mono text-[10px] leading-5">
              {logs.length === 0 && <p className="py-4 text-center italic text-[var(--nv-text-muted)]">还没有日志</p>}
              {logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="shrink-0 text-[var(--nv-text-muted)]">{fmtTime(l.createdAt)}</span>
                  <span
                    className={`shrink-0 ${
                      l.level === "error" ? "text-red-600" : l.level === "warn" ? "text-amber-600" : "text-[var(--nv-text-tertiary)]"
                    }`}
                  >
                    [{l.level}]
                  </span>
                  <span className="min-w-0 flex-1 text-[var(--nv-text-secondary)]">
                    {l.message}
                    {l.detail && <span className="text-[var(--nv-text-muted)]"> · {l.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-3 text-[10px] leading-5 text-[var(--nv-text-tertiary)]">
            <p className="mb-1 text-[11px] font-medium text-amber-700">平台红线（务必知道）</p>
            <p>
              番茄打击的是「大规模量产低质」：单日更新多本书、AI 批量铺量、注水同质。2026 年已处置账号 5000+、
              拒签约 AI 低质书 16 万本。本工具的边界就是：<b>1 个账号、1 本书、日更 ≤3 章、体检过关才发</b>，
              并且不做多账号矩阵。签约时的原创声明是法律责任，AI 参与的部分请保留你的人工把关。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
