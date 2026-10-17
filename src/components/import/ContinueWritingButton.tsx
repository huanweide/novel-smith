"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { describeStreamError } from "@/lib/stream-error";

/**
 * 「从此继续写」按钮（Import Novel · M2）
 *
 * 放在阅读器里，因为用户产生这个念头的瞬间就在这儿：「读到这儿想接着写」。
 * 点了就在导入内容之后新建一个 source=user 的章节节点，然后跳进写作区。
 *
 * 为什么不给「续写」按钮预填 AI 内容：
 * 前史上下文（M3 的角色卡/世界书/digest）还没接上，现在生成必然是断的。
 * 先把节点骨架建好，M3 上来直接填肉，比现在就产出一个没法用的稿子强。
 */
export function ContinueWritingButton({
  projectId,
  afterNodeId,
  afterTitle,
  onCreated,
  size = "sm",
}: {
  projectId: string;
  /** 承接的章节 id（阅读器当前所在章），没有则接在最后 */
  afterNodeId?: string | null;
  afterTitle?: string;
  onCreated?: (nodeId: string) => void;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/import/novel/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          afterNodeId: afterNodeId ?? null,
          title: afterTitle ? `续写 · 接《${afterTitle}》之后` : "续写",
          contextDigest: afterTitle ? `承接自导入章节《${afterTitle}》` : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toastError(json.error ?? "创建续写节点失败");
        return;
      }
      toastSuccess(`已新建章节《${json.node.title}》，去写作区开写`);
      if (onCreated) onCreated(json.node.id);
      else router.push(`/workspace/${projectId}?node=${json.node.id}`);
    } catch (e) {
      const f = describeStreamError(e);
      toastError(f ? `${f.title}：${f.description}` : "网络异常，创建失败");
    } finally {
      setBusy(false);
    }
  }, [busy, projectId, afterNodeId, afterTitle, onCreated, router]);

  const pad = size === "sm" ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2";
  return (
    <button
      type="button"
      onClick={start}
      disabled={busy}
      title="在导入内容之后新建一章，接着往下写"
      className={`btn-ghost rounded-lg flex items-center gap-1 ${pad} disabled:opacity-50`}
      aria-label="从此继续写"
    >
      <Icon name="pencil" size={size === "sm" ? 13 : 15} />
      <span>{busy ? "创建中…" : "继续写"}</span>
    </button>
  );
}
