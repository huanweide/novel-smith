"use client";

import { asArray } from "@/lib/utils";
import { type ReactNode } from "react";
import { Icon, StatusDot } from "@/components/ui/icons";
import { TagChip } from "./TagChip";
import type { CharacterData } from "./types";
import { CHARACTER_ROLE_OPTIONS } from "@/lib/character-parse";

export function CharacterFilters({
  characters,
  search,
  onSearch,
  roleFilter,
  statusFilter,
  tagFilter,
  onRole,
  onStatus,
  onTag,
  onRemoveTag,
}: {
  characters: CharacterData[];
  search: string;
  onSearch: (v: string) => void;
  roleFilter: string;
  statusFilter: string;
  tagFilter: string;
  onRole: (v: string) => void;
  onStatus: (v: string) => void;
  onTag: (v: string) => void;
  /** 删除用户自建标签类型（从所有角色移除） */
  onRemoveTag?: (tag: string) => void;
}) {
  // 从所有角色标签中提取唯一值（过滤掉系统标签 📥📝 与软删标记 🗂 已合并）
  const allTags = Array.from(
    new Set(
      characters.flatMap((c) =>
        asArray<string>(c.tags).filter((t) => !t.startsWith("📥") && !t.startsWith("📝") && t !== "🗂 已合并"),
      ),
    ),
  ).sort();

  const statRole = (r: string) => characters.filter(c => c.role === r).length;
  const statDead = characters.filter(c => ["dead", "missing", "presumed_dead"].includes(c.currentStatus)).length;

  return (
    <>
      {/* 搜索 + 筛选（合并展示：搜索框独占一行，筛选 chips 紧随其后，标签同类合并减少层级） */}
      <div className="mb-1.5">
        <input
          type="text"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="搜索角色…"
          aria-label="搜索角色"
          className="w-full bg-[var(--nv-surface-1)] border border-[var(--nv-border-2)] rounded px-2 py-1 text-xs text-[var(--nv-text-primary)] placeholder:text-[var(--nv-text-tertiary)] focus:outline-none focus:border-[var(--nv-primary)]"
        />
      </div>

      {/* 筛选栏 + 标签（合并为一层 flex-wrap，避免多行堆叠的拥挤感） */}
      <div className="flex gap-1 mb-1.5 flex-wrap items-center text-xs">
        {([
          { key: "all", label: "全部", count: characters.length },
          ...CHARACTER_ROLE_OPTIONS.map((o) => ({ key: o.value, label: o.label, count: statRole(o.value) })),
        ] as { key: string; label: ReactNode; count: number }[]).filter(o => o.count > 0 || o.key === "all").map(o => (
          <TagChip
            key={o.key}
            label={o.label}
            count={o.count}
            active={roleFilter === o.key}
            onClick={() => { onRole(roleFilter === o.key ? "all" : o.key); onTag("all"); }}
          />
        ))}
        {([
          { key: "alive", label: <span className="flex items-center gap-1"><StatusDot color="green" size={6} /> 存活</span>, count: characters.length - statDead },
          { key: "dead", label: <span className="flex items-center gap-1"><Icon name="skull" size={10} /> 离场</span>, count: statDead },
        ] as { key: string; label: ReactNode; count: number }[]).filter(o => o.count > 0).map(o => (
          <TagChip
            key={o.key}
            label={o.label}
            count={o.count}
            active={statusFilter === o.key}
            onClick={() => { onStatus(statusFilter === o.key ? "all" : o.key); }}
          />
        ))}
        {allTags.slice(0, 8).map(t => (
          <span key={t} className="group/tag relative inline-flex items-center">
            <TagChip
              label={t}
              active={tagFilter === t}
              onClick={() => onTag(tagFilter === t ? "all" : t)}
            />
            {onRemoveTag && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemoveTag(t); }}
                title={`删除标签「${t}」`}
                aria-label={`删除标签 ${t}`}
                className="ml-[-4px] z-10 rounded-full opacity-0 group-hover/tag:opacity-100 text-[var(--nv-text-tertiary)] hover:text-[var(--nv-danger)] transition-opacity p-0.5"
              >
                <Icon name="x" size={9} />
              </button>
            )}
          </span>
        ))}
        {allTags.length > 8 && (
          <span className="text-[9px] text-[var(--nv-text-tertiary)]">+{allTags.length - 8}</span>
        )}
        {(roleFilter !== "all" || tagFilter !== "all" || statusFilter !== "all") && (
          <TagChip
            label={<Icon name="x" size={11} />}
            onClick={() => { onRole("all"); onTag("all"); onStatus("all"); }}
          />
        )}
      </div>
    </>
  );
}
