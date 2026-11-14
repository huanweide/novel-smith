"use client";

/**
 * 意图盘（左栏「自由」页签）——只放三件事，其余一概不进这里
 *
 * 这一栏的职责被收窄过一次：
 *   原先还塞了「我的目标」「我确立的设定」「因果账」，三块都常驻，
 *   结果是左栏又挤又像表单，而且把地图、关系这些**已经有专门模块**的东西重复了一遍。
 *   现在这里只回答一个问题：**此刻能做什么**。
 *
 * 三种互动方式，对应玩家真正会用的三条路：
 *   ① 点牌 → 直接推进（最省事，不需要想）
 *   ② 自己写 → 写什么都行（最自由，但不必填）
 *   ③ 正文里的选项 / 地点牌 → 顺着剧情走、在地图上移动（在主区域，不放这儿）
 *
 * 视觉约束（上一版被吐槽字看不清）：
 *   · 卡面用浮起面 + 主文字色，不用 muted 灰；
 *   · 不靠边框分层，靠底色；边框只做极淡提示；
 *   · 一屏 6 张，超过要滚就等于又变成负担。
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import type { IntentCard } from "@/core/game/intent-deck";
import type { SceneBundle } from "@/core/game/scene";

interface ActInput {
  actionType: string;
  actionText: string;
  target?: string;
  targetItem?: string;
}

interface Props {
  sessionId: string | null;
  /** 轮次变化时重新拉取（回合结算后处境会变） */
  round: number;
  disabled?: boolean;
  onAct: (card: ActInput) => void;
  /** 被拦下：原因 + 可点的替代做法 */
  blocked?: { reason: string; alternatives: string[] } | null;
  onDismissBlocked?: () => void;
  onPickAlternative?: (text: string) => void;
}

const EMPTY_SCENE: SceneBundle = {
  present: [],
  knownElsewhere: [],
  items: [],
  places: [],
  threads: [],
  basis: "none",
};

/** 牌面颜色：只区分「人 / 事 / 地 / 物」，不做彩虹 */
const BADGE: Record<IntentCard["group"], string> = {
  person: "text-[var(--nv-creative)]",
  thread: "text-[var(--nv-warning,#d9a441)]",
  place: "text-[var(--nv-accent,#6fb3d2)]",
  item: "text-[var(--nv-text-secondary)]",
  self: "text-[var(--nv-text-tertiary)]",
};

export function FreedomSection({
  sessionId,
  round,
  disabled,
  onAct,
  blocked,
  onDismissBlocked,
  onPickAlternative,
}: Props) {
  const [scene, setScene] = useState<SceneBundle>(EMPTY_SCENE);
  const [deck, setDeck] = useState<IntentCard[]>([]);
  const [mode, setMode] = useState<string>("first");
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await fetch(`/api/game/scene?sessionId=${encodeURIComponent(sessionId)}`);
      const d = await r.json();
      if (d?.ok) {
        setScene(d.scene || EMPTY_SCENE);
        setDeck(Array.isArray(d.deck) ? d.deck : []);
        setMode(d.mode || "first");
      } else {
        setScene(EMPTY_SCENE);
        setDeck([]);
      }
    } catch {
      setScene(EMPTY_SCENE);
      setDeck([]);
    } finally {
      setLoaded(true);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, round]);

  const send = (card: ActInput) => {
    if (disabled) return;
    onAct(card);
  };

  if (!sessionId) {
    return (
      <p className="text-[11px] leading-relaxed text-[var(--nv-text-tertiary)]">
        开始游戏后，这里会列出此刻能做的事
      </p>
    );
  }

  const modeLabel = mode === "god" ? "上帝" : mode === "third" ? "小说" : "沉浸";
  const where = [scene.time, scene.place].filter(Boolean).join(" · ");

  return (
    <div className="space-y-3">
      {/* ── 此处：地点 + 在场（回答"我在哪、和谁"，不是状态面板） ── */}
      <section className="rounded-xl bg-[var(--nv-surface-2)] px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Icon name="mapPin" size={11} className="shrink-0 text-[var(--nv-creative)]" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--nv-text-primary)]">
            {where || (scene.present.length > 0 ? `与${scene.present[0]}同处` : "所在不详")}
          </span>
          <span className="shrink-0 text-[9px] text-[var(--nv-text-tertiary)]">{modeLabel}</span>
        </div>
        {scene.present.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {scene.present.slice(0, 3).map((n) => (
              <span
                key={n}
                className="rounded-md bg-[var(--nv-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--nv-text-primary)]"
              >
                {n}
              </span>
            ))}
            {scene.present.length > 3 && (
              <span className="self-center text-[9px] text-[var(--nv-text-tertiary)]">+{scene.present.length - 3}</span>
            )}
          </div>
        )}
      </section>

      {mode === "god" && (
        <p className="px-0.5 font-serif text-[10px] leading-snug text-[var(--nv-text-tertiary)]">
          你在高处看着这一切。写下什么，它就发生。
        </p>
      )}

      {/* ── 牌：点一下就推进，不必想 ── */}
      {!loaded ? (
        <p className="text-[10px] text-[var(--nv-text-tertiary)]">正在看四周…</p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {deck.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                send({ actionType: c.actionType, actionText: c.actionText, target: c.target, targetItem: c.targetItem })
              }
              disabled={disabled}
              title={c.actionText}
              className="group flex min-h-[52px] flex-col justify-between rounded-xl bg-[var(--nv-surface-2)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--nv-surface-3)] disabled:opacity-50"
            >
              <span className="flex w-full items-baseline gap-1.5">
                <span className={`shrink-0 text-[10px] font-medium ${BADGE[c.group] || BADGE.self}`}>{c.verb}</span>
                <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] font-medium leading-tight text-[var(--nv-text-primary)]">
                  {c.object}
                </span>
              </span>
              <span className="mt-1 flex w-full items-center gap-1 text-[9.5px] text-[var(--nv-text-tertiary)]">
                <span className="min-w-0 flex-1 truncate">{c.hint}</span>
                {c.cost && <span className="shrink-0">{c.cost}</span>}
                {c.risk && <span className="shrink-0 text-[var(--nv-warning,#d9a441)]">险</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── 拦下：写在界面上，不写进正文 ── */}
      {blocked && (
        <section className="rounded-xl bg-[var(--nv-surface-2)] px-3 py-2">
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--nv-text-primary)]">
            <Icon name="ban" size={11} className="mt-0.5 shrink-0 text-[var(--nv-warning,#d9a441)]" />
            <span className="min-w-0 flex-1">{blocked.reason}</span>
            {onDismissBlocked && (
              <button
                onClick={onDismissBlocked}
                className="shrink-0 text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
              >
                <Icon name="x" size={10} />
              </button>
            )}
          </p>
          {blocked.alternatives.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {blocked.alternatives.slice(0, 3).map((a) => (
                <button
                  key={a}
                  onClick={() => onPickAlternative?.(a)}
                  className="rounded-md bg-[var(--nv-surface-3)] px-1.5 py-0.5 text-[10px] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)]"
                >
                  {a}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── 自己写：最自由的一条路，但不必填 ── */}
      <div className="flex gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) {
              send({ actionType: "custom", actionText: text.trim() });
              setText("");
            }
          }}
          maxLength={300}
          placeholder="或者，你自己写一句…"
          className="input-glass min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--nv-text-primary)] placeholder:text-[var(--nv-text-tertiary)]"
        />
        <button
          onClick={() => {
            if (!text.trim()) return;
            send({ actionType: "custom", actionText: text.trim() });
            setText("");
          }}
          disabled={disabled || !text.trim()}
          className="btn-ghost shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] disabled:opacity-40"
          title="发出这句话"
        >
          <Icon name="arrowRight" size={11} />
        </button>
      </div>
    </div>
  );
}
