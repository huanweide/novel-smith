"use client";

import { useCallback, useEffect, useState } from "react";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { describeStreamError } from "@/lib/stream-error";

/**
 * 导入前史资产草稿面板（M3）
 *
 * 导入完成后如果提炼出了角色卡 / 世界书草稿，这个面板会接管对话框的下半部分，
 * 让作者决定「采纳」还是「丢弃」。
 *
 * ## 为什么非得让人过一遍
 * 规则提炼必然误判——路人甲会被当角色，「方才」会被当人名。
 * 而这些卡一旦 approved 就会进入**每一次**生成的上下文，误判会持续污染输出。
 * 所以默认全不采纳，只在作者点头后才生效。
 * 「一键全采纳」放在这里是为了省事，不是默认值。
 */

interface DraftCharacter {
  id: string;
  name: string;
  role: string;
  background: string;
  tags: unknown;
}

interface DraftLore {
  id: string;
  title: string;
  category: string;
  content: string;
}

interface DraftCommitment {
  id: string;
  description: string;
  priority: string;
  developmentHint: string | null;
}

interface AssetsPayload {
  characters: DraftCharacter[];
  lore: DraftLore[];
  commitments: DraftCommitment[];
}

export function ImportAssetsPanel({
  projectId,
  /** 导入刚落库时的即时计数，用于给作者一个「提炼出多少」的第一印象 */
  seeded,
  onDone,
}: {
  projectId: string;
  seeded?: {
    charactersCreated: number;
    loreCreated: number;
    commitmentsCreated: number;
    digestsUpdated: boolean;
  } | null;
  onDone?: () => void;
}) {
  const [data, setData] = useState<AssetsPayload | null>(null);
  const [pickedChars, setPickedChars] = useState<Set<string>>(new Set());
  const [pickedLore, setPickedLore] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"" | "approve" | "reject" | "prefill">("");
  const [loading, setLoading] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [prefillMsg, setPrefillMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/import/novel/assets?projectId=${encodeURIComponent(projectId)}&status=pending`);
      const json = await res.json();
      if (!res.ok || !json.ok) return;
      setData({
        characters: json.characters ?? [],
        lore: json.lore ?? [],
        commitments: json.commitments ?? [],
      });
    } catch (e) {
      const f = describeStreamError(e);
      toastError(f ? `${f.title}：${f.description}` : "草稿加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (
    set: Set<string>,
    setter: (v: Set<string>) => void,
    id: string,
  ) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  /** M4：AI 预填——把草稿补成完整卡（烧 token，所以要用户明确点头） */
  const doPrefill = useCallback(async () => {
    setBusy("prefill");
    setPrefillMsg("");
    try {
      const res = await fetch("/api/import/novel/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          action: "prefill",
          characters: [...pickedChars],
          lore: [...pickedLore],
          autoApprove,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        toastError(json.error ?? "预填失败");
        return;
      }
      const r = json.result;
      const cOk = (r.characters ?? []).filter((c: { ok: boolean }) => c.ok).length;
      const lOk = (r.lore ?? []).filter((l: { ok: boolean }) => l.ok).length;
      const cFail = (r.characters ?? []).length - cOk;
      const lFail = (r.lore ?? []).length - lOk;
      setPrefillMsg(
        `预填完成：角色 ${cOk} 条、世界设定 ${lOk} 条` +
        (cFail + lFail > 0 ? `；${cFail + lFail} 条原文证据不足被跳过` : ""),
      );
      toastSuccess("AI 预填完成");
      await load();
    } catch (e) {
      const f = describeStreamError(e);
      toastError(f ? `${f.title}：${f.description}` : "网络异常，预填失败");
    } finally {
      setBusy("");
    }
  }, [projectId, pickedChars, pickedLore, autoApprove, load]);

  const apply = useCallback(
    async (action: "approve" | "reject") => {
      setBusy(action);
      try {
        const res = await fetch("/api/import/novel/assets", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            characters: [...pickedChars],
            lore: [...pickedLore],
            action,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          toastError(json.error ?? "处理失败");
          return;
        }
        toastSuccess(
          action === "approve"
            ? `已采纳 ${json.characters} 张角色卡、${json.lore} 条世界设定`
            : `已丢弃 ${json.characters} 张角色卡、${json.lore} 条世界设定`,
        );
        await load();
        onDone?.();
      } catch (e) {
        const f = describeStreamError(e);
        toastError(f ? `${f.title}：${f.description}` : "网络异常");
      } finally {
        setBusy("");
      }
    },
    [projectId, pickedChars, pickedLore, load, onDone],
  );

  const charIds = (data?.characters ?? []).map((c) => c.id);
  const loreIds = (data?.lore ?? []).map((l) => l.id);
  const allPicked =
    charIds.length + loreIds.length > 0 &&
    charIds.every((id) => pickedChars.has(id)) &&
    loreIds.every((id) => pickedLore.has(id));

  const toggleAll = () => {
    if (allPicked) {
      setPickedChars(new Set());
      setPickedLore(new Set());
    } else {
      setPickedChars(new Set(charIds));
      setPickedLore(new Set(loreIds));
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--nv-border)] p-4 text-xs text-[var(--nv-text-muted)]">
        正在加载提炼出的前史草稿…
      </div>
    );
  }

  const total = charIds.length + loreIds.length;
  if (total === 0) {
    return (
      <div className="rounded-lg border border-[var(--nv-border)] p-4 text-xs">
        {seeded && (seeded.charactersCreated > 0 || seeded.loreCreated > 0)
          ? "草稿已处理完毕，可以关闭对话框开始阅读或续写了。"
          : "没有提炼出新的角色卡 / 世界书草稿（项目里已有的同名条目不会被重复创建）。"}
        {seeded?.digestsUpdated && (
          <div className="mt-1 text-[var(--nv-text-muted)]">
            已同时生成时间线与故事线摘要，续写时会作为长期记忆注入。
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--nv-accent)]/40 bg-[var(--nv-accent)]/5 p-3 text-xs">
        <div className="font-medium">
          顺带提炼出 {total} 条前史草稿（{charIds.length} 角色 / {loreIds.length} 世界设定）
        </div>
        <div className="mt-1 text-[var(--nv-text-secondary)]">
          规则提炼难免误判，因此全部先存为<span className="font-medium">待审</span>：
          采纳后才进入生成上下文，丢弃则永不再用。伏笔{" "}
          <span className="font-medium">{data?.commitments.length ?? 0}</span>{" "}
          条已直接入库（伏笔本就是待兑现清单，天然安全）。
        </div>
        {seeded?.digestsUpdated && (
          <div className="mt-1 text-[var(--nv-text-muted)]">
            时间线 / 故事线摘要已生成，续写时会作为长期记忆注入。
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={toggleAll}
          className="text-[var(--nv-text-muted)] underline underline-offset-2"
        >
          {allPicked ? "取消全选" : "全选"}
        </button>
        <span className="text-[var(--nv-text-muted)]">
          已选 {pickedChars.size + pickedLore.size} / {total}
        </span>
      </div>

      <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--nv-border)]">
        <table className="w-full text-xs">
          <tbody>
            {data?.characters.map((c) => (
              <tr key={c.id} className="border-b border-[var(--nv-border-2)] last:border-0">
                <td className="w-8 py-1.5 pl-2 align-top">
                  <input
                    type="checkbox"
                    checked={pickedChars.has(c.id)}
                    onChange={() => toggle(pickedChars, setPickedChars, c.id)}
                    aria-label={`选择角色 ${c.name}`}
                  />
                </td>
                <td className="py-1.5 pr-2 align-top">
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-[var(--nv-text-muted)]">角色卡</span>
                  <div className="mt-0.5 truncate text-[var(--nv-text-muted)]">
                    {c.background}
                  </div>
                </td>
              </tr>
            ))}
            {data?.lore.map((l) => (
              <tr key={l.id} className="border-b border-[var(--nv-border-2)] last:border-0">
                <td className="w-8 py-1.5 pl-2 align-top">
                  <input
                    type="checkbox"
                    checked={pickedLore.has(l.id)}
                    onChange={() => toggle(pickedLore, setPickedLore, l.id)}
                    aria-label={`选择设定 ${l.title}`}
                  />
                </td>
                <td className="py-1.5 pr-2 align-top">
                  <span className="font-medium">{l.title}</span>
                  <span className="ml-2 text-[var(--nv-text-muted)]">
                    {l.category}
                  </span>
                  <div className="mt-0.5 truncate text-[var(--nv-text-muted)]">
                    {l.content}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.commitments.length > 0 && (
        <div className="rounded-lg border border-[var(--nv-border)] p-3 text-xs">
          <div className="mb-1 font-medium">
            自动识别的伏笔 {data.commitments.length} 条
          </div>
          <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-4 text-[var(--nv-text-secondary)]">
            {data.commitments.slice(0, 10).map((c) => (
              <li key={c.id}>
                <span className="mr-1 text-[var(--nv-text-muted)]">[{c.priority}]</span>
                {c.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={doPrefill}
          disabled={
            busy !== "" || (pickedChars.size === 0 && pickedLore.size === 0)
          }
          className="rounded-lg border border-[var(--nv-accent)] px-3 py-1.5 text-xs text-[var(--nv-accent)] disabled:opacity-50"
        >
          {busy === "prefill" ? "AI 预填中…" : "AI 预填所选"}
        </button>
        <button
          type="button"
          onClick={() => apply("approve")}
          disabled={
            busy !== "" || (pickedChars.size === 0 && pickedLore.size === 0)
          }
          className="rounded-lg bg-[var(--nv-accent)] px-3 py-1.5 text-xs font-medium text-[var(--nv-accent-fg)] disabled:opacity-50"
        >
          {busy === "approve" ? "采纳中…" : "采纳所选"}
        </button>
        <button
          type="button"
          onClick={() => apply("reject")}
          disabled={
            busy !== "" || (pickedChars.size === 0 && pickedLore.size === 0)
          }
          className="rounded-lg border border-[var(--nv-border)] px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {busy === "reject" ? "丢弃中…" : "丢弃所选"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--nv-text-muted)]">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
        />
        预填后直接采纳（不再待审）
        <span className="ml-1">
          — LLM 也会编造设定，建议保持关闭，先扫一眼再用
        </span>
      </label>

      {prefillMsg && (
        <div className="rounded-lg border border-[var(--nv-border)] p-2 text-xs text-[var(--nv-text-secondary)]">
          {prefillMsg}
        </div>
      )}
    </div>
  );
}
