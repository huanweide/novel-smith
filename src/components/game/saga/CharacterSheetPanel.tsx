"use client";

/**
 * CharacterSheetPanel —— 游戏本「角色卡 / 个人界面」
 *
 * 玩家反馈原状：左栏只有「同伴」列表，看不到「我」；角色信息只有名字 + 一句描述，无法查看个人背包与状态。
 *
 * 本面板承担四件事：
 * 1. 个人界面：身份/头衔/年龄/外貌/性格/背景 + 状态（体力/精神/伤势/情绪/位置）
 * 2. 个人背包：该角色名下全部物品（按四类分组；损毁有徽章）
 * 3. 能力与关系：abilities 作为跑团检定的加成依据；relations 记录谁和谁什么关系
 * 4. 编辑与换人：字段可直接改（表单式，未填的留空即可）；「以 TA 的身份继续」更新 saga.playAsName
 *
 * 数据：GET/PATCH /api/game/saga/[sagaId]/characters；背包来自当前会话 items（owner 匹配）。
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { toastError, toastSubtle } from "@/components/ui/toast";

export interface CharacterSheet {
  name: string;
  role?: string;
  title?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  abilities?: string[];
  status?: { hp?: number; spirit?: number; injury?: string; mood?: string; location?: string };
  relations?: Array<{ name: string; relation: string; level?: number }>;
  notes?: string;
  isPlayer?: boolean;
  /** 退场死亡：名录垫后，卡仍可打开（character-admission.ts） */
  dead?: boolean;
  exitRound?: number;
  /** 探查所得（inspect 路由写入）：看清过的东西永久知情 */
  revealed?: {
    insight?: string;
    inventory?: Array<{ name: string; desc?: string; round?: number }>;
  };
  updatedAt?: string;
}

interface SheetItem {
  name: string;
  category?: string;
  owner?: string;
  broken?: boolean;
  effect?: string;
}

interface Props {
  sagaId: string;
  open: boolean;
  initialName: string | null;
  isPlayerView: boolean;
  /** 当前会话全部物品（用于按 owner 过滤出个人背包） */
  items: SheetItem[];
  onClose: () => void;
  /** 换人成功后通知父级刷新（playAsName 变了） */
  onPlayAsChanged?: (name: string) => void;
  /** 把「使用某物品」作为一次行动发出 */
  onUseItem?: (itemName: string) => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  consumable: "消耗品",
  equipment: "装备",
  quest: "任务道具",
  currency: "货币",
};

const STATUS_FIELDS: Array<{ key: "hp" | "spirit"; label: string; color: string }> = [
  { key: "hp", label: "体力", color: "var(--nv-danger)" },
  { key: "spirit", label: "精神", color: "var(--nv-primary)" },
];

export function CharacterSheetPanel({
  sagaId, open, initialName, isPlayerView, items, onClose, onPlayAsChanged, onUseItem,
}: Props) {
  const [sheets, setSheets] = useState<Record<string, CharacterSheet>>({});
  const [playAsName, setPlayAsName] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(initialName);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CharacterSheet | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "读取角色卡失败");
        setSheets(data.sheets || {});
        setPlayAsName(data.playAsName || null);
      } catch (e: any) {
        toastError(e.message || "读取角色卡失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, initialName, sagaId]);

  useEffect(() => {
    if (!open) { setEditing(false); setForm(null); }
  }, [open]);

  const sheet: CharacterSheet | null = name ? sheets[name] || { name } : null;

  // 个人背包：owner 匹配（空 owner 视为玩家）；货币单独归组
  const personalItems = useMemo(() => {
    if (!name) return [] as SheetItem[];
    return items.filter((it) => (it.owner || playAsName || "主角") === name);
  }, [items, name, playAsName]);

  const grouped = useMemo(() => {
    const g: Record<string, SheetItem[]> = { consumable: [], equipment: [], quest: [], currency: [] };
    for (const it of personalItems) {
      const k = it.category && g[it.category] ? it.category : "quest";
      g[k].push(it);
    }
    return g;
  }, [personalItems]);

  const startEdit = () => {
    if (!sheet) return;
    setForm({
      ...sheet,
      abilities: [...(sheet.abilities || [])],
      status: { ...(sheet.status || {}) },
      relations: [...(sheet.relations || [])],
    });
    setEditing(true);
  };

  const save = async () => {
    if (!form || !name) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, patch: form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setSheets((prev) => ({ ...prev, [name]: data.sheet }));
      setEditing(false);
      toastSubtle("角色卡已保存——之后每一轮 AI 都会参考这份档案");
    } catch (e: any) {
      toastError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const switchTo = async () => {
    if (!name) return;
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playAsName: name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "换人失败");
      setPlayAsName(name);
      toastSubtle(`现在以「${name}」的身份继续——下一轮叙事会换成 TA 的视角`);
      onPlayAsChanged?.(name);
    } catch (e: any) {
      toastError(e.message || "换人失败");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex shrink-0 items-start gap-3 border-b border-[var(--nv-border-2)] px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--nv-creative)]/15 text-base font-bold text-[var(--nv-creative)]">
            {name ? name.slice(0, 1) : "?"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-bold text-[var(--nv-text-primary)]">{name || "角色卡"}</h3>
              {name === playAsName && (
                <span className="rounded-full bg-[var(--nv-primary)]/12 px-2 py-0.5 text-[10px] font-medium text-[var(--nv-primary)]">你正在扮演</span>
              )}
              {sheet?.title && <span className="rounded-full bg-[var(--nv-surface-3)] px-2 py-0.5 text-[10px] text-[var(--nv-text-secondary)]">{sheet.title}</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--nv-text-tertiary)]">
              {[sheet?.role, sheet?.age ? `${sheet.age}` : "", sheet?.status?.location].filter(Boolean).join(" · ") || "还没有档案——点「编辑角色卡」填表"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!editing && (
              <button onClick={startEdit} className="rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1 text-[11px] text-[var(--nv-text-secondary)] hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)]">
                编辑角色卡
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--nv-text-muted)] hover:bg-[var(--nv-surface-3)] hover:text-[var(--nv-text-primary)]">
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {/* 角色切换 chips（未指定扮演者时先在这里选一个） */}
        {Object.keys(sheets).length > 0 && (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[var(--nv-border-2)] px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {Object.keys(sheets).map((n) => (
              <button
                key={n}
                onClick={() => { setName(n); setEditing(false); }}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition-colors ${n === name ? "bg-[var(--nv-creative)]/15 font-medium text-[var(--nv-creative)]" : "text-[var(--nv-text-tertiary)] hover:bg-[var(--nv-surface-3)] hover:text-[var(--nv-text-primary)]"}`}
              >
                {n}{n === playAsName ? " ★" : ""}{sheets[n]?.dead ? " 殁" : ""}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="py-10 text-center text-xs text-[var(--nv-text-muted)]">读取角色卡…</p>
          ) : Object.keys(sheets).length === 0 && !name ? (
            <CreateSheet onCreate={async (newName) => {
              try {
                const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newName, patch: { role: "主角" } }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "创建失败");
                setSheets((prev) => ({ ...prev, [newName]: data.sheet }));
                setName(newName);
                toastSubtle(`已创建「${newName}」的角色卡——点「编辑角色卡」填表`);
              } catch (e: any) {
                toastError(e.message || "创建失败");
              }
            }} />
          ) : editing && form ? (
            <EditForm form={form} setForm={setForm} saving={saving} onSave={save} onCancel={() => setEditing(false)} />
          ) : (
            <SheetView sheet={sheet} grouped={grouped} onUseItem={onUseItem} />
          )}
        </div>

        {/* 底部：换人 */}
        {!editing && name && name !== playAsName && (
          <div className="shrink-0 border-t border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 px-5 py-3">
            <button
              onClick={switchTo}
              className="w-full rounded-xl bg-[var(--nv-creative)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.99]"
            >
              以「{name}」的身份继续（换人）
            </button>
            <p className="mt-1 text-center text-[10px] text-[var(--nv-text-muted)]">
              换人只切换叙事视角与检定加成来源，世界与进度不变；随时可以换回来
            </p>
          </div>
        )}
        {!editing && name && name === playAsName && (
          <div className="shrink-0 border-t border-[var(--nv-border-2)] px-5 py-2.5 text-center text-[10px] text-[var(--nv-text-muted)]">
            这是你当前扮演的角色 · {isPlayerView ? "叙事以第二人称「你」展开" : ""}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateSheet({ onCreate }: { onCreate: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2 py-6 text-center">
      <p className="text-xs text-[var(--nv-text-muted)]">还没有角色卡——先建一张（之后可以逐项填表）</p>
      <div className="mx-auto flex max-w-xs gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="角色名字，如：林舟"
          className="min-w-0 flex-1 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-creative-soft)]"
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) onCreate(value.trim()); }}
        />
        <button
          onClick={() => { if (value.trim()) onCreate(value.trim()); }}
          disabled={!value.trim()}
          className="shrink-0 rounded-lg bg-[var(--nv-creative)] px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
        >
          创建
        </button>
      </div>
    </div>
  );
}

function SheetView({ sheet, grouped, onUseItem }: {
  sheet: CharacterSheet | null;
  grouped: Record<string, SheetItem[]>;
  onUseItem?: (name: string) => void;
}) {
  if (!sheet) return <p className="py-10 text-center text-xs text-[var(--nv-text-muted)]">从上方选一个角色查看 TA 的角色卡（点「以 TA 的身份继续」即可换人）</p>;
  const totalItems = Object.values(grouped).reduce((n, arr) => n + arr.length, 0);
  return (
    <div className="space-y-4">
      {/* 状态 */}
      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold text-[var(--nv-text-secondary)]">个人状态</h4>
        <div className="grid grid-cols-2 gap-2">
          {STATUS_FIELDS.map((f) => {
            const v = sheet.status?.[f.key];
            return (
              <div key={f.key} className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/60 px-3 py-2">
                <div className="flex items-center justify-between text-[10px] text-[var(--nv-text-tertiary)]">
                  <span>{f.label}</span>
                  <span>{typeof v === "number" ? `${v}/100` : "未记录"}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--nv-surface-3)]">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%`, background: f.color }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {sheet.status?.injury && <span className="rounded-full bg-[var(--nv-danger)]/10 px-2 py-0.5 text-[var(--nv-danger)]">伤势：{sheet.status.injury}</span>}
          {sheet.status?.mood && <span className="rounded-full bg-[var(--nv-surface-3)] px-2 py-0.5 text-[var(--nv-text-secondary)]">情绪：{sheet.status.mood}</span>}
          {sheet.status?.location && <span className="rounded-full bg-[var(--nv-surface-3)] px-2 py-0.5 text-[var(--nv-text-secondary)]">位置：{sheet.status.location}</span>}
          {!sheet.status?.injury && !sheet.status?.mood && !sheet.status?.location && (
            <span className="text-[var(--nv-text-muted)]">状态未记录——编辑角色卡可补</span>
          )}
        </div>
      </section>

      {/* 档案 */}
      <section>
        <h4 className="mb-1.5 text-[11px] font-semibold text-[var(--nv-text-secondary)]">档案</h4>
        <dl className="space-y-1.5 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40 px-3 py-2.5 text-[11px]">
          {[
            ["身份", sheet.role],
            ["头衔", sheet.title],
            ["年龄", sheet.age],
            ["外貌", sheet.appearance],
            ["性格", sheet.personality],
            ["背景", sheet.background],
          ].map(([k, v]) => (
            <div key={k as string} className="flex gap-2">
              <dt className="w-8 shrink-0 text-[var(--nv-text-muted)]">{k}</dt>
              <dd className={`min-w-0 flex-1 leading-relaxed ${v ? "text-[var(--nv-text-secondary)]" : "text-[var(--nv-text-muted)]"}`}>{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 能力 */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--nv-text-secondary)]">
          能力 / 金手指
          <span className="font-normal text-[var(--nv-text-muted)]">（跑团检定时作为加成依据）</span>
        </h4>
        {sheet.abilities && sheet.abilities.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sheet.abilities.map((a) => (
              <span key={a} className="rounded-lg border border-[var(--nv-creative)]/25 bg-[var(--nv-creative)]/[0.07] px-2 py-1 text-[10px] text-[var(--nv-creative)]">{a}</span>
            ))}
          </div>
        ) : <p className="text-[10px] text-[var(--nv-text-muted)]">未记录——编辑角色卡填写后，检定时会按它给加成</p>}
      </section>

      {/* 关系 */}
      {sheet.relations && sheet.relations.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[11px] font-semibold text-[var(--nv-text-secondary)]">关系</h4>
          <div className="space-y-1">
            {sheet.relations.map((r, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--nv-surface-2)]/50 px-2.5 py-1.5 text-[10px]">
                <span className="font-medium text-[var(--nv-text-primary)]">{r.name}</span>
                <span className="text-[var(--nv-text-tertiary)]">{r.relation}</span>
                {typeof r.level === "number" && (
                  <span className="ml-auto text-[var(--nv-text-muted)]">{r.level > 0 ? `好感 +${r.level}` : r.level < 0 ? `敌意 ${r.level}` : "中立"}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 个人背包 */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-[var(--nv-text-secondary)]">
          个人背包
          <span className="font-normal text-[var(--nv-text-muted)]">（{totalItems} 件）</span>
        </h4>
        {totalItems === 0 ? (
          <p className="text-[10px] text-[var(--nv-text-muted)]">看起来两手空空——但 TA 说什么，你可要自己判断</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(grouped).filter(([, arr]) => arr.length > 0).map(([cat, arr]) => (
              <div key={cat}>
                <p className="mb-0.5 text-[9px] uppercase tracking-wider text-[var(--nv-text-muted)]">{CATEGORY_LABEL[cat] || cat}</p>
                <div className="space-y-1">
                  {arr.map((it, i) => (
                    <div key={`${it.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 px-2.5 py-1.5">
                      <span className={`min-w-0 flex-1 truncate text-[11px] ${it.broken ? "text-[var(--nv-text-muted)] line-through" : "text-[var(--nv-text-primary)]"}`}>{it.name}</span>
                      {it.broken && <span className="rounded bg-[var(--nv-danger)]/10 px-1 text-[9px] text-[var(--nv-danger)]">损</span>}
                      {it.effect && <span className="max-w-[45%] truncate text-[9px] text-[var(--nv-text-tertiary)]">{it.effect}</span>}
                      {onUseItem && cat !== "currency" && (
                        <button
                          onClick={() => onUseItem(it.name)}
                          className="shrink-0 rounded-md border border-[var(--nv-border-2)] px-1.5 py-0.5 text-[9px] text-[var(--nv-text-tertiary)] hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-creative)]"
                        >
                          {cat === "equipment" ? "装备" : "使用"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {sheet.notes && (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--nv-text-secondary)]">备注</h4>
          <p className="whitespace-pre-wrap rounded-lg bg-[var(--nv-surface-2)]/50 px-3 py-2 text-[11px] leading-relaxed text-[var(--nv-text-secondary)]">{sheet.notes}</p>
        </section>
      )}
    </div>
  );
}

function EditForm({ form, setForm, saving, onSave, onCancel }: {
  form: CharacterSheet;
  setForm: (f: CharacterSheet) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<CharacterSheet>) => setForm({ ...form, ...patch });
  const setStatus = (patch: Partial<NonNullable<CharacterSheet["status"]>>) =>
    setForm({ ...form, status: { ...(form.status || {}), ...patch } });

  const inputCls = "w-full rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-creative-soft)]";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">身份 / 职业</span>
          <input value={form.role || ""} onChange={(e) => set({ role: e.target.value })} className={inputCls} placeholder="如：外卖员 / 剑修" /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">头衔 / 称号</span>
          <input value={form.title || ""} onChange={(e) => set({ title: e.target.value })} className={inputCls} placeholder="如：青云宗外门弟子" /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">年龄</span>
          <input value={form.age || ""} onChange={(e) => set({ age: e.target.value })} className={inputCls} placeholder="如：19" /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">所在位置</span>
          <input value={form.status?.location || ""} onChange={(e) => setStatus({ location: e.target.value })} className={inputCls} placeholder="如：城南破庙" /></label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">体力（0-100）</span>
          <input type="number" min={0} max={100} value={form.status?.hp ?? ""} onChange={(e) => setStatus({ hp: e.target.value === "" ? undefined : Number(e.target.value) })} className={inputCls} /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">精神（0-100）</span>
          <input type="number" min={0} max={100} value={form.status?.spirit ?? ""} onChange={(e) => setStatus({ spirit: e.target.value === "" ? undefined : Number(e.target.value) })} className={inputCls} /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">伤势</span>
          <input value={form.status?.injury || ""} onChange={(e) => setStatus({ injury: e.target.value })} className={inputCls} placeholder="如：左臂刀伤" /></label>
        <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">情绪</span>
          <input value={form.status?.mood || ""} onChange={(e) => setStatus({ mood: e.target.value })} className={inputCls} placeholder="如：警惕" /></label>
      </div>
      <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">外貌</span>
        <textarea rows={2} value={form.appearance || ""} onChange={(e) => set({ appearance: e.target.value })} className={inputCls} /></label>
      <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">性格</span>
        <textarea rows={2} value={form.personality || ""} onChange={(e) => set({ personality: e.target.value })} className={inputCls} /></label>
      <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">背景</span>
        <textarea rows={3} value={form.background || ""} onChange={(e) => set({ background: e.target.value })} className={inputCls} /></label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">能力 / 金手指（一行一个，检定时作为加成依据）</span>
        <textarea
          rows={3}
          value={(form.abilities || []).join("\n")}
          onChange={(e) => set({ abilities: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
          className={inputCls}
          placeholder={"如：\n寒潭剑意（近战 +15）\n过目不忘（调查 +10）"}
        />
      </label>
      <label className="block"><span className="mb-0.5 block text-[10px] text-[var(--nv-text-tertiary)]">备注（你自己记的）</span>
        <textarea rows={2} value={form.notes || ""} onChange={(e) => set({ notes: e.target.value })} className={inputCls} /></label>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving} className="flex-1 rounded-xl bg-[var(--nv-creative)] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60">
          {saving ? "保存中…" : "保存角色卡"}
        </button>
        <button onClick={onCancel} className="rounded-xl border border-[var(--nv-border-2)] px-4 py-2 text-xs text-[var(--nv-text-secondary)] hover:border-[var(--nv-border-3)]">取消</button>
      </div>
    </div>
  );
}
