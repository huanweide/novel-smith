/**
 * 故事线工作台：单条线索行（原 StorylineWorkbench.tsx 私有组件 ClueRow）
 */

import { useState } from "react";
import { Icon } from "@/components/ui/icons";
import { DialogInput } from "../DialogUI";

export function ClueRow({
  clue,
  onPatch,
  onDelete,
}: {
  clue: { id: string; tag: string; content: string };
  onPatch: (id: string, patch: Record<string, string>) => void;
  onDelete: (id: string) => void;
}) {
  const [tag, setTag] = useState(clue.tag);
  const [content, setContent] = useState(clue.content);
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3">
      <div className="mb-1.5 flex items-center gap-2">
        {editing ? (
          <DialogInput value={tag} onChange={setTag} className="w-32" placeholder="标签" />
        ) : (
          <span className="rounded bg-[var(--nv-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--nv-accent)]">
            {clue.tag || "未分类"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {editing ? (
            <>
              <button
                onClick={() => {
                  onPatch(clue.id, { tag, content });
                  setEditing(false);
                }}
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--nv-success)] hover:bg-[var(--nv-success)]/10"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setTag(clue.tag);
                  setContent(clue.content);
                  setEditing(false);
                }}
                className="rounded px-1.5 py-0.5 text-[10px] text-[var(--nv-text-tertiary)] hover:bg-[var(--nv-surface-2)]"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                aria-label="编辑线索"
                className="rounded p-1 text-[var(--nv-text-tertiary)] hover:text-[var(--nv-primary)]"
                title="编辑线索"
              >
                <Icon name="pencil" size={12} />
              </button>
              <button
                onClick={() => onDelete(clue.id)}
                aria-label="删除线索"
                className="rounded p-1 text-[var(--nv-text-tertiary)] hover:text-[var(--nv-danger)]"
                title="删除线索"
              >
                <Icon name="trash" size={12} />
              </button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <DialogInput rows={2} value={content} onChange={setContent} />
      ) : (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--nv-text-primary)]">
          {clue.content}
        </div>
      )}
    </div>
  );
}
