"use client";

/**
 * 游戏本 · 叙事系统页签（移植自小说模式）
 *
 * 「故事」：故事线树（主线/支线 + 三/七要素）、章节时间轴、线索集、因果链、
 *          伏笔五状态与收束率、跨章世界线编年、6 阶段进度。
 * 「设定」：15 类世界卡（自动登记→待审→确认），注入深度、启停、改分类。
 *
 * 抄的是小说系统 `StorylineWorkbench` 的**信息结构**：
 *   左树（主线→支线，完结沉底）+ 四区（总纲要素 / 章节时间轴 / 线索集 / 因果链）
 *   + 进度条 + 里程碑计数 + `WorldPanel` 的 15 板块 chip + 待审闸门。
 * 不抄它的 Modal 与 871 行实现——游戏本把全部内容收进左抽屉，正文区一件 UI 都不加。
 *
 * 纸本朱墨风：零圆角、单朱强调色、细墨线分组。数据走
 *   GET/PATCH /api/game/saga/[sagaId]/narrative。
 */

import { useCallback, useEffect, useState } from "react";
import {
  ALL_WORLD_CATEGORIES,
  WORLD_CATEGORY_LABELS,
  type WorldCategory,
} from "@/lib/world-category-classifier";
import type { NarrativeStage } from "@/core/pipeline/narrative-stage";
import type {
  NarrativeLedger,
  SagaCommitment,
  SagaStoryline,
  SagaWorldCard,
} from "@/core/game/narrative/types";
import {
  COMMITMENT_STATUS_LABEL,
  DEPTH_LABEL,
  EVENT_KIND_LABEL,
  LINE_STATUS_LABEL,
  LINE_TYPE_LABEL,
  WORLD_MODULE_LABELS,
} from "@/core/game/narrative/types";
import { computePayoffStats } from "@/core/game/narrative/foreshadow";
import { computeStorylineProgress } from "@/core/game/narrative/storyline";

interface Props {
  sagaId: string;
  /** 每轮结束后父级 load() 会递增，用来触发重新拉取（实时演算同步） */
  refreshKey?: number;
}

interface LedgerResponse {
  ok: boolean;
  ledger: NarrativeLedger;
  stage: NarrativeStage;
  summary: string;
}

function useLedger(sagaId: string, refreshKey?: number) {
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/narrative`);
      if (!res.ok) throw new Error("读取叙事账本失败");
      const j = await res.json();
      setData(j);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "读取失败");
    } finally {
      setLoading(false);
    }
  }, [sagaId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/narrative`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error || "操作失败");
    }
    await load();
  }, [sagaId, load]);

  return { data, loading, error, reload: load, patch };
}

/** 细线小标题：纸本里不用卡片，靠界栏线分组 */
function Sect({ title, extra, children }: { title: string; extra?: string; children?: React.ReactNode }) {
  return (
    <div className="nv-sect">
      <p className="nv-sect-h">{title}{extra && <span>　{extra}</span>}</p>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="nv-empty">{text}</p>;
}

// ─── 故事页 ────────────────────────────────────────────────────

type StoryView = "lines" | "payoff" | "chronicle";

export function NarrativeStoryPanel({ sagaId, refreshKey }: Props) {
  const { data, loading, error, patch } = useLedger(sagaId, refreshKey);
  const [view, setView] = useState<StoryView>("lines");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [clueInput, setClueInput] = useState("");
  const [newLine, setNewLine] = useState("");
  const [newPayoff, setNewPayoff] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>, key?: string) => {
    setBusy(key || "act");
    setErr(null);
    try { await patch(body); } catch (e: any) { setErr(e?.message || "操作失败"); }
    finally { setBusy(null); }
  };

  if (loading) return <Empty text="正在翻开叙事账本…" />;
  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="暂无叙事账本" />;

  const { ledger, stage, summary } = data;
  const mains = ledger.storylines.filter((s) => s.type === "main");
  const sides = ledger.storylines.filter((s) => s.type === "side");
  const selected = ledger.storylines.find((s) => s.id === selectedId) || mains[0] || ledger.storylines[0] || null;
  const stats = computePayoffStats(ledger.commitments);
  const timeline = selected
    ? selected.events.filter((e) => e.kind !== "CLUE").sort((a, b) => a.position - b.position)
    : [];
  const clues = selected ? selected.events.filter((e) => e.kind === "CLUE") : [];
  const elementKeys = selected?.type === "main"
    ? ["origin", "process", "result"]
    : ["desire", "obstacle", "action", "result", "twist", "turn", "ending"];
  const elementLabels: Record<string, string> = {
    origin: "起因", process: "经过", result: "结果",
    desire: "欲望", obstacle: "阻碍", action: "行动", twist: "意外", turn: "转折", ending: "结局",
  };

  return (
    <div className="nv-panel">
      {/* 阶段进度：6 阶段抄小说系统，游戏本永远不自动进高潮/收尾 */}
      <div className="nv-stage">
        <div className="nv-stage-row">
          <span className="nv-stage-k">全书阶段</span>
          <span className="nv-stage-v">{stage.label}</span>
          <span className="nv-stage-pct">{stage.percent}%</span>
        </div>
        <div className="nv-stage-bar"><i style={{ width: `${stage.percent}%` }} /></div>
        <p className="nv-stage-note">{summary}</p>
      </div>

      {/* 三视图：故事线 / 伏笔 / 世界线。用文字切换，不做一堆按钮 */}
      <div className="nv-subtabs">
        {([
          ["lines", `故事线 ${ledger.storylines.length}`],
          ["payoff", `伏笔 ${stats.pending + stats.partial}`],
          ["chronicle", `世界线 ${ledger.chronicle.length}`],
        ] as const).map(([k, label]) => (
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>

      {err && <p className="nv-err">{err}</p>}

      {/* ── 故事线：左树 + 四区 ── */}
      {view === "lines" && (
        <>
          <Sect title="故事线" extra={`${mains.length} 主线 · ${sides.length} 支线`}>
            {ledger.storylines.length === 0 ? (
              <Empty text="还没有故事线。你做过的事会自动长成一条线，也可以自己开一条。" />
            ) : (
              <div className="nv-line-tree">
                {mains.map((m) => (
                  <div key={m.id}>
                    <LineRow line={m} selected={selected?.id === m.id} onPick={() => setSelectedId(m.id)} />
                    {sides.filter((s) => s.parentId === m.id).map((s) => (
                      <LineRow key={s.id} line={s} child selected={selected?.id === s.id} onPick={() => setSelectedId(s.id)} />
                    ))}
                  </div>
                ))}
                {sides.filter((s) => !mains.some((m) => m.id === s.parentId)).map((s) => (
                  <LineRow key={s.id} line={s} child selected={selected?.id === s.id} onPick={() => setSelectedId(s.id)} />
                ))}
              </div>
            )}
            <div className="nv-add-row">
              <input
                className="nv-input"
                value={newLine}
                placeholder="新开一条支线（不写就是不派任务）"
                onChange={(e) => setNewLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newLine.trim()) {
                    act({ action: "createLine", title: newLine.trim(), type: "side" }, "newLine");
                    setNewLine("");
                  }
                }}
              />
            </div>
          </Sect>

          {selected && (
            <>
              <Sect title="总纲" extra={selected.type === "main" ? "三要素" : "七要素"}>
                <div className="nv-elems">
                  {elementKeys.map((k) => {
                    const v = selected.sevenElements?.[k] || "";
                    return (
                      <div className="nv-elem" key={k}>
                        <span className="nv-elem-k">{elementLabels[k]}</span>
                        <span className={`nv-elem-v${v ? "" : " empty"}`}>{v || "待长出来"}</span>
                      </div>
                    );
                  })}
                </div>
                {selected.type === "main" && (
                  <p className="nv-hint">主线用起因/经过/结果提纲挈领；结局不预填。</p>
                )}
                <div className="nv-line-actions">
                  {selected.status === "active" && (
                    <button disabled={busy !== null} onClick={() => act({ action: "completeLine", lineId: selected.id }, "complete")}>
                      标记完结（自动回填要素）
                    </button>
                  )}
                  <button disabled={busy !== null} onClick={() => act({ action: "switchLineType", lineId: selected.id, type: selected.type === "main" ? "side" : "main" }, "switch")}>
                    转为{selected.type === "main" ? "支线" : "主线"}
                  </button>
                </div>
                {(() => {
                  const p = computeStorylineProgress(selected);
                  return <p className="nv-hint">要素进度：{p.label}</p>;
                })()}
              </Sect>

              <Sect title="章节时间轴" extra={`${timeline.length} 条`}>
                {timeline.length === 0 ? (
                  <Empty text="时间轴会在你行动时自动记录关键节点——先去做点什么，回来就能看到它长出来。" />
                ) : (
                  <ol className="nv-timeline">
                    {timeline.slice(-12).map((e) => (
                      <li key={e.id}>
                        <span className="nv-tl-k">{EVENT_KIND_LABEL[e.kind]}</span>
                        <span className="nv-tl-t">{e.title || e.content}</span>
                        {e.tag && <em>{e.tag}</em>}
                      </li>
                    ))}
                  </ol>
                )}
              </Sect>

              <Sect title="线索集" extra={`${clues.length} 条`}>
                {clues.length === 0 ? (
                  <Empty text="伏笔、物证、人物备注都可以记在这里——别漏掉自己挖的坑。" />
                ) : (
                  <div className="nv-clues">
                    {clues.map((c) => (
                      <p key={c.id}><em>[{c.tag || "未分类"}]</em>{c.content}</p>
                    ))}
                  </div>
                )}
                <div className="nv-add-row">
                  <input
                    className="nv-input"
                    value={clueInput}
                    placeholder="记一条线索"
                    onChange={(e) => setClueInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && clueInput.trim()) {
                        act({ action: "addClue", lineId: selected.id, content: clueInput.trim() }, "clue");
                        setClueInput("");
                      }
                    }}
                  />
                </div>
              </Sect>
            </>
          )}
        </>
      )}

      {/* ── 伏笔：五状态 + 收束率 ── */}
      {view === "payoff" && (
        <>
          <div className="nv-payoff">
            <div className="nv-stage-row">
              <span className="nv-stage-k">收束率</span>
              <span className="nv-stage-v">{Math.round(stats.payoffRate * 100)}%</span>
            </div>
            <div className="nv-stage-bar"><i style={{ width: `${Math.round(stats.payoffRate * 100)}%` }} /></div>
            <p className="nv-stage-note">
              共 {stats.total} 条 · {stats.pending} 待收 · {stats.partial} 部分收 · {stats.fulfilled} 已收 · {stats.voided} 悬空
            </p>
          </div>
          <Sect title="伏笔" extra="按状态分组">
            <div className="nv-add-row">
              <input
                className="nv-input"
                value={newPayoff}
                placeholder="自己埋一条伏笔（写一句想以后收的事）"
                onChange={(e) => setNewPayoff(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newPayoff.trim()) {
                    act({ action: "addCommitment", description: newPayoff.trim() }, "newPayoff");
                    setNewPayoff("");
                  }
                }}
              />
            </div>
            {ledger.commitments.length === 0 ? (
              <Empty text="还没有埋下伏笔。种下的因会自己长成伏笔，被兑现时自动回收。" />
            ) : (
              (["pending", "detected", "partially_fulfilled", "fulfilled", "voided"] as const).map((status) => {
                const list = ledger.commitments.filter((c) => c.status === status);
                if (list.length === 0) return null;
                return (
                  <div className="nv-pay-group" key={status}>
                    <p className="nv-pay-gh">{COMMITMENT_STATUS_LABEL[status]}　{list.length}</p>
                    {list.map((c) => (
                      <CommitRow key={c.id} c={c} busy={busy !== null} onSet={(s) => act({ action: "setCommitment", id: c.id, status: s }, c.id)} />
                    ))}
                  </div>
                );
              })
            )}
          </Sect>
        </>
      )}

      {/* ── 世界线：跨章编年 ── */}
      {view === "chronicle" && (
        <Sect title="这条世界线走过的地方" extra={`${ledger.chronicle.length} 章`}>
          {ledger.chronicle.length === 0 ? (
            <Empty text="一本游戏本就是一条世界线。每章走过的地方会按时间排在这里。" />
          ) : (
            <ol className="nv-chronicle">
              {ledger.chronicle.map((c) => (
                <li key={c.id}>
                  <span className="nv-ch-n">第 {c.chapterIndex + 1} 章</span>
                  <span className="nv-ch-t">{c.chapterTitle}</span>
                  {c.worldTime && <em>{c.worldTime}</em>}
                  <p>{c.summary}</p>
                  {c.keyEvents.length > 0 && <p className="nv-ch-ev">大事：{c.keyEvents.join(" · ")}</p>}
                </li>
              ))}
            </ol>
          )}
        </Sect>
      )}
    </div>
  );
}

function LineRow({ line, child, selected, onPick }: { line: SagaStoryline; child?: boolean; selected: boolean; onPick: () => void }) {
  const p = computeStorylineProgress(line);
  return (
    <button className={`nv-line-row${child ? " child" : ""}${selected ? " on" : ""}`} onClick={onPick}>
      <span className="nv-line-type">{LINE_TYPE_LABEL[line.type]}</span>
      <span className="nv-line-title">{line.title}</span>
      <span className="nv-line-status">
        {line.status !== "active" ? LINE_STATUS_LABEL[line.status] : `${line.events.filter((e) => e.kind !== "CLUE").length} 事`}
      </span>
      {line.type === "side" && <span className="nv-line-pct">{p.overallPercent}%</span>}
    </button>
  );
}

function CommitRow({ c, busy, onSet }: { c: SagaCommitment; busy: boolean; onSet: (s: string) => void }) {
  return (
    <div className="nv-pay-row">
      <p className="nv-pay-desc">{c.description}</p>
      <p className="nv-pay-meta">
        第{c.plantedRound}轮埋下 · {c.source === "causality" ? "由因果种子自动登记" : c.source}
        {c.fulfilledRound ? ` · 第${c.fulfilledRound}轮收` : ""}
      </p>
      {(c.status === "pending" || c.status === "detected" || c.status === "partially_fulfilled") && (
        <div className="nv-pay-btns">
          <button disabled={busy} onClick={() => onSet("fulfilled")}>标记已收</button>
          <button disabled={busy} onClick={() => onSet("voided")}>作废</button>
        </div>
      )}
    </div>
  );
}

// ─── 设定页：15 类世界卡 ───────────────────────────────────────

export function NarrativeLorePanel({ sagaId, refreshKey }: Props) {
  const { data, loading, error, patch } = useLedger(sagaId, refreshKey);
  const [filter, setFilter] = useState<WorldCategory | "all">("all");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [newCard, setNewCard] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setErr(null);
    try { await patch(body); } catch (e: any) { setErr(e?.message || "操作失败"); }
    finally { setBusy(null); }
  };

  if (loading) return <Empty text="正在翻开世界卡…" />;
  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="暂无世界卡" />;

  const cards = data.ledger.worldCards;
  const pending = cards.filter((c) => c.reviewStatus === "pending").length;
  const shown = cards.filter((c) =>
    (filter === "all" || c.category === filter) && (!pendingOnly || c.reviewStatus === "pending"),
  );
  const grouped = ALL_WORLD_CATEGORIES.map((cat) => ({
    cat,
    label: WORLD_MODULE_LABELS[cat],
    list: shown.filter((c) => c.category === cat),
  })).filter((g) => g.list.length > 0 || filter === g.cat);

  return (
    <div className="nv-panel">
      <div className="nv-stage">
        <div className="nv-stage-row">
          <span className="nv-stage-k">世界卡</span>
          <span className="nv-stage-v">{cards.length} 张</span>
        </div>
        <p className="nv-stage-note">
          新遇到的人、地方、物件会自动登记为「待确认」。确认后才会进入 AI 的叙事上下文——
          免得模型随口一句名词就悄悄变成世界设定。
        </p>
      </div>

      <div className="nv-cat-bar">
        <button className={filter === "all" && !pendingOnly ? "on" : ""} onClick={() => { setFilter("all"); setPendingOnly(false); }}>
          全部 {cards.length}
        </button>
        <button className={pendingOnly ? "on" : ""} onClick={() => setPendingOnly((v) => !v)}>
          待确认 {pending}
        </button>
      </div>
      <div className="nv-cat-grid">
        {ALL_WORLD_CATEGORIES.map((cat) => {
          const n = cards.filter((c) => c.category === cat).length;
          return (
            <button key={cat} className={filter === cat ? "on" : ""} onClick={() => setFilter(filter === cat ? "all" : cat)} title={WORLD_CATEGORY_LABELS[cat]}>
              {WORLD_MODULE_LABELS[cat]}<em>{n}</em>
            </button>
          );
        })}
      </div>

      <div className="nv-add-row">
        <input
          className="nv-input"
          value={newCard}
          placeholder="手填一张世界卡（名字会自动归到 15 类）"
          onChange={(e) => setNewCard(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newCard.trim()) {
              act({ action: "addCard", title: newCard.trim(), category: filter === "all" ? undefined : filter }, "newCard");
              setNewCard("");
            }
          }}
        />
      </div>

      {err && <p className="nv-err">{err}</p>}

      {shown.length === 0 ? (
        <Empty text="这一类还没有世界卡。去世界里走走，遇到什么就会自动登记。" />
      ) : (
        grouped.map((g) => (
          <Sect key={g.cat} title={g.label} extra={`${g.list.length} 张`}>
            {g.list.length === 0 ? <Empty text="空" /> : g.list.map((c) => (
              <CardRow key={c.id} c={c} busy={busy === c.id} onApprove={() => act({ action: "approveCard", id: c.id }, c.id)} onToggle={() => act({ action: "patchCard", id: c.id, patch: { enabled: !c.enabled } }, c.id)} />
            ))}
          </Sect>
        ))
      )}
    </div>
  );
}

function CardRow({ c, busy, onApprove, onToggle }: { c: SagaWorldCard; busy: boolean; onApprove: () => void; onToggle: () => void }) {
  return (
    <div className={`nv-card${c.reviewStatus === "pending" ? " pending" : ""}${c.enabled ? "" : " off"}`}>
      <div className="nv-card-head">
        <span className="nv-card-t">{c.title}</span>
        <em>{c.reviewStatus === "pending" ? "待确认" : "已确认"}</em>
      </div>
      {c.content && <p className="nv-card-c">{c.content}</p>}
      <p className="nv-card-meta">第{c.createdRound}轮登记 · {DEPTH_LABEL[c.depth] || `深度 ${c.depth}`}{c.enabled ? "" : " · 已停用"}</p>
      <div className="nv-card-btns">
        {c.reviewStatus === "pending" && <button disabled={busy} onClick={onApprove}>确认收录</button>}
        <button disabled={busy} onClick={onToggle}>{c.enabled ? "停用" : "启用"}</button>
      </div>
    </div>
  );
}
