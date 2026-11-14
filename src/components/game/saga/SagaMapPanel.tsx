"use client";

/**
 * 游戏本地图（右栏「地图」页签）
 *
 * 移植自 novel-forge 的世界地图，判据原样保留：
 *   · 走格子表，不做力导向——同一份数据每次打开都在同一格，玩家能对着念、能核对；
 *   · 人物在格内按固定顺序排（主角 → 关系权重），不交给布局引擎；
 *   · 不知道在哪的人进「行踪不明」，不推测、不硬塞。
 *
 * 数据全部来自 /api/game/scene（与意图盘同源），不额外请求、不另算一次，
 * 否则会出现"左栏说他在场、地图说他在别处"这种自相矛盾。
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import type { SagaMap } from "@/core/game/saga-map";

interface Props {
  sessionId: string | null;
  /** 轮次变化时重取（有人移动/关系变化会立刻反映） */
  round: number;
  /** 点地名 → 把"前往某地"写进行动框 */
  onGoto?: (name: string) => void;
}

const EMPTY: SagaMap = {
  cols: 1,
  rows: 1,
  cells: [null],
  unplaced: [],
  relations: [],
  stats: { places: 0, people: 0, placed: 0, unplaced: 0 },
};

export function SagaMapPanel({ sessionId, round, onGoto }: Props) {
  const [map, setMap] = useState<SagaMap>(EMPTY);
  const [current, setCurrent] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      const r = await fetch(`/api/game/scene?sessionId=${encodeURIComponent(sessionId)}`);
      const d = await r.json();
      if (d?.ok) {
        setMap(d.map || EMPTY);
        setCurrent(d.scene?.place || undefined);
      } else {
        setMap(EMPTY);
      }
    } catch {
      setMap(EMPTY);
    } finally {
      setLoaded(true);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load, round]);

  if (!sessionId) {
    return <p className="text-[11px] text-[var(--nv-text-tertiary)]">开始游戏后可查看地图</p>;
  }
  if (!loaded) {
    return <p className="text-[10px] text-[var(--nv-text-tertiary)]">正在铺开地图…</p>;
  }

  const hasAny = map.stats.places > 0 || map.unplaced.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-1.5">
        <Icon name="map" size={11} className="translate-y-[1px] text-[var(--nv-creative)]" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--nv-text-primary)]">
          {current || "所在不详"}
        </span>
        <span className="shrink-0 text-[9px] text-[var(--nv-text-tertiary)]">
          {map.stats.places} 处 · {map.stats.people} 人
        </span>
      </div>

      {!hasAny ? (
        <p className="text-[10px] leading-relaxed text-[var(--nv-text-tertiary)]">
          还没有地点。世界书里加一条「地理」条目，或让剧情走到某个地方，这里就会长出来。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {map.cells.map((cell, i) =>
            cell ? (
              <button
                key={cell.label}
                onClick={() => onGoto?.(cell.place)}
                title={`前往${cell.place}`}
                className={`flex min-h-[64px] flex-col rounded-lg px-2 py-1.5 text-left transition-colors ${
                  cell.isCurrent
                    ? "bg-[var(--nv-creative)]/[0.12] ring-1 ring-[var(--nv-creative)]/40"
                    : "bg-[var(--nv-surface-2)] hover:bg-[var(--nv-surface-3)]"
                }`}
              >
                <span className="flex w-full items-baseline gap-1">
                  <span className="shrink-0 font-mono text-[9.5px] text-[var(--nv-text-secondary)]">{cell.label}</span>
                  <span className="line-clamp-2 min-w-0 flex-1 text-[10.5px] font-medium leading-tight text-[var(--nv-text-primary)]">
                    {cell.place}
                  </span>
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {cell.people.length === 0 && (
                    <span className="text-[9px] text-[var(--nv-text-tertiary)]">空无一人</span>
                  )}
                  {cell.people.map((p) => (
                    <span
                      key={p.name}
                      className={`rounded px-1 py-0.5 text-[9px] ${
                        p.isPlayer
                          ? "bg-[var(--nv-creative)]/20 text-[var(--nv-creative)]"
                          : "bg-[var(--nv-surface-3)] text-[var(--nv-text-secondary)]"
                      }`}
                    >
                      {p.name}
                    </span>
                  ))}
                  {cell.overflow > 0 && (
                    <span className="self-center text-[9px] text-[var(--nv-text-tertiary)]">+{cell.overflow}</span>
                  )}
                </span>
              </button>
            ) : (
              <div key={`empty-${i}`} className="min-h-[64px] rounded-lg border border-dashed border-[var(--nv-border-2)]/50" />
            )
          )}
        </div>
      )}

      {map.unplaced.length > 0 && (
        <section>
          <p className="mb-1 text-[9px] text-[var(--nv-text-tertiary)]">行踪不明（档案里没有记位置）</p>
          <div className="flex flex-wrap gap-1">
            {map.unplaced.slice(0, 8).map((p) => (
              <span key={p.name} className="rounded bg-[var(--nv-surface-2)] px-1.5 py-0.5 text-[9.5px] text-[var(--nv-text-tertiary)]">
                {p.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {map.relations.length > 0 && (
        <section>
          <p className="mb-1 text-[9px] text-[var(--nv-text-tertiary)]">与你的关系</p>
          <ul className="space-y-0.5">
            {map.relations.map((r) => (
              <li key={r.name} className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[10.5px] text-[var(--nv-text-secondary)]">{r.name}</span>
                <span
                  className={`shrink-0 text-[9.5px] ${
                    r.level >= 0 ? "text-[var(--nv-creative)]" : "text-[var(--nv-danger,#e06c75)]"
                  }`}
                >
                  {r.label}
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[9px] text-[var(--nv-text-muted)]">
                  {r.level > 0 ? `+${r.level}` : r.level}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[9px] leading-snug text-[var(--nv-text-muted)]">
        位置来自人物档案，空着就是不知道——不猜。点格子可前往。
      </p>
    </div>
  );
}
