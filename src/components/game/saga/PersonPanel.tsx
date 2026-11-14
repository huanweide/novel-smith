"use client";

/**
 * PersonPanel —— 人物卡（鬼谷八荒式：左栏动作 + 右侧档案页签）
 *
 * 布局定调（2026-11-14 深夜，用户拿鬼谷八荒人物界面作参考）：
 *   「本身不该局限于此……看看它左侧 UI 栏能做些什么，自由度有多高；
 *     想看更详细的情报、具体的设定，可以点击他的档案一个个进入查看；
 *     你要对它做的事情不止这些，下面的很多选项本身就是针对这个角色来进行的。」
 *
 *   ┌──────────┬──────────────────────┐
 *   │ 左栏      │  概览 | 底细 | 随身 | 关系 | 本事 │
 *   │ 交谈(主)  │──────────────────────│
 *   │ 试探×3    │   档案页签内容（滚动）  │
 *   │ 强硬×4    │                      │
 *   │ 事务×3    │                      │
 *   │ 往来×3    │                      │
 *   │ 惯用招×6  │                      │
 *   │ 标记      │                      │
 *   └──────────┴──────────────────────┘
 *   底部：自由输入（永远在，永远不被拒绝）
 *
 * 铁律不变：好感只改难度，永远不删选项——左栏每一个动词对任何人都在；
 * 看不清的只是**信息**（底细打码），不是**动作**。
 * 页签 = 鬼谷的档案页（人物属性/故事/道具/关系），详细情报一页页进；
 * 外面这张卡仍是小界面——打开即用，不必翻页也能做任何事（左栏全在）。
 */

import { useEffect, useRef, useState } from "react";
import {
  MASK_TEXT,
  actionGroupsFor,
  knowledgeLabel,
  knowledgeOf,
  personify,
  riskLabel,
  selfActionsFor,
  shouldMask,
  type PersonAction,
} from "@/core/game/person-view";
import { relationTier } from "@/core/game/relation-ledger";
import { deadSeal, isGenericName } from "@/core/game/character-admission";
import { tierLabel } from "@/core/game/inspect";
import type { ExtendedAction } from "@/core/game/verbs";
import type { CharacterSheet } from "./CharacterSheetPanel";

/** 探查回执（与 inspect 路由的响应对齐）：判定过程透明，让玩家看见这一把为什么是这个数 */
interface InspectResult {
  verdict: {
    tier: "critical" | "success" | "fail" | "blunder";
    d100: number;
    rate: number;
    parts: Array<{ label: string; value: number }>;
    reveals: { background: boolean; inventory: boolean };
    alertDelta: number;
    note: string;
  };
  inventory?: Array<{ name: string; desc?: string }>;
  insight?: string;
}

interface SheetItem {
  name: string;
  quantity: number;
  owner?: string;
  category?: string;
  damaged?: boolean;
  equipped?: boolean;
}

/** 档案页签：概览=状态+属性速览；底细=故事+洞察；随身=背包+送/摸；关系=关系网+定义关系；本事=功法神通 */
type Tab = "overview" | "detail" | "carry" | "relations" | "skills";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "概览" },
  { key: "detail", label: "底细" },
  { key: "carry", label: "随身" },
  { key: "relations", label: "关系" },
  { key: "skills", label: "本事" },
];

interface Props {
  open: boolean;
  name: string;
  sagaId: string;
  /** 好感值 -100 ~ +100；0 表示还没打过交道 */
  level: number;
  items: SheetItem[];
  extSlots: ExtendedAction[];
  disabled?: boolean;
  /** 一句话描述（来自实体表，人物卡没填字段时的兜底） */
  fallbackBrief?: string;
  /** 点开的是主角自己：不给「辱骂/偷他东西」这套 */
  isSelf?: boolean;
  onAct: (text: string, type?: string) => void;
  /** 剧情选项文本（本轮叙事给出的三个选择）：细写编辑器里作建议 chips */
  suggestions?: string[];
  /** 改六格（编辑器在左栏，正文区不再放这套 UI） */
  onExtChange?: (slots: ExtendedAction[]) => void;
  onClose: () => void;
}

/** 好感刻度：十格，朱色填充。不用进度条——那是一条会动的线，看不出「到哪一档」 */
function RelationScale({ level }: { level: number }) {
  const filled = Math.round((Math.abs(level) / 100) * 10);
  const negative = level < 0;
  return (
    <span className={`zp-scale${negative ? " neg" : ""}`} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < filled ? "on" : ""} />
      ))}
    </span>
  );
}

function Field({ label, value, masked }: { label: string; value?: string; masked?: boolean }) {
  if (!value || !value.trim()) return null;
  return (
    <div className="zp-field">
      <span className="zp-field-k">{label}</span>
      <span className={`zp-field-v${masked ? " masked" : ""}`}>{masked ? MASK_TEXT : value}</span>
    </div>
  );
}

export function PersonPanel({
  open, name, sagaId, level, items, extSlots, disabled, fallbackBrief, isSelf, onAct, suggestions, onExtChange, onClose,
}: Props) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [editExt, setEditExt] = useState(false);
  const [custom, setCustom] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState<string | null>(null);
  // 探查（判定来源是你自己：功法神通/情报，骰子裁成败，AI 只补货不判成败）
  const [inspecting, setInspecting] = useState(false);
  const [inspectRes, setInspectRes] = useState<InspectResult | null>(null);
  const [inspectErr, setInspectErr] = useState<string | null>(null);
  // 头像（导入 / AI 生成）：busy 标明在干哪件事，消息给卡内回执
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatarBusy, setAvatarBusy] = useState<null | "import" | "gen">(null);
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null);
  // 定义关系（鬼谷红框「定义关系」的等价物）：玩家自己记「我和他是什么关系」
  const [relNote, setRelNote] = useState("");
  const [relSaved, setRelSaved] = useState(false);
  const [savingMark, setSavingMark] = useState(false);
  // 细写（用户口径 2026-11-15）：固定动作默认一键出手不繁琐；开了之后点动作先展开
  // 可选输入——空=默认句直接出，写了带细节出，剧情选项 chips 一键填。
  // 必须放在早退 return 之前：放后面会在 open=false 的首渲里被 useEffect 闭包
  // 捕获成 TDZ 死区，一打开卡就炸「Cannot access before initialization」（实测踩过）。
  const [fineWrite, setFineWrite] = useState(false);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailText, setDetailText] = useState("");

  // 人物卡正文：只在打开且换人时拉一次
  useEffect(() => {
    if (!open || !name) return;
    let alive = true;
    setSheet(null);
    (async () => {
      try {
        const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters`);
        if (!res.ok) return;
        const data = await res.json();
        // 接口返回的是 { ok, playAsName, sheets: Record<名字, 人物卡>, candidates }
        // ——不是数组。按数组读会永远拿到空（本轮实测踩过）。
        const map: Record<string, CharacterSheet> =
          data && typeof data.sheets === "object" && data.sheets ? data.sheets : {};
        if (alive) setSheet(map[name] || null);
      } catch {
        /* 拉不到就只显示已知信息，不编造 */
      }
    })();
    return () => { alive = false; };
  }, [open, name, sagaId]);

  useEffect(() => {
    if (!open) { setTab("overview"); setCustom(""); setFillMsg(null); setInspectRes(null); setInspectErr(null); setAvatarMsg(null); setAvatarBusy(null); setRelNote(""); setRelSaved(false); setFineWrite(false); setDetailKey(null); setDetailText(""); }
  }, [open]);

  // 换人时清掉上一轮反馈，回到概览
  useEffect(() => { setFillMsg(null); setTab("overview"); setRelNote(""); setRelSaved(false); }, [name]);

  if (!open || !name) return null;

  // 「点开的是不是我自己」：saga.playAsName 可能为 null（实测某些存档进游戏时没写），
  // 所以以人物卡里的 isPlayer 为准，prop 只作兜底。
  const self = !!isSelf || !!sheet?.isPlayer;

  // ── 泛称占位卡：店小二这类无名之辈不立卡（准入铁律），但话仍可以对他说 ──
  if (!self && isGenericName(name)) {
    return (
      <>
        <div className="zp-mask" onClick={onClose} />
        <aside className="zp-panel" role="dialog" aria-label={name}>
          <header className="zp-head">
            <div className="zp-portrait" aria-hidden><span>{(name || "").slice(0, 1)}</span></div>
            <div className="zp-head-main">
              <h2 className="zp-name">{name}</h2>
              <p className="zp-title">无名之辈 · 不立卡</p>
            </div>
            <button className="zp-close" onClick={onClose} aria-label="关闭">✕</button>
          </header>
          <p className="zp-empty">他连个名字都没有，谈不上什么恩怨。要对他说什么，写在下面就行。</p>
          <div className="zp-write">
            <input
              className="zp-input"
              value={custom}
              placeholder={`对${name}做什么，直接写`}
              disabled={disabled}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) {
                  onAct(personify(custom.trim(), name));
                  setCustom("");
                }
              }}
            />
            <button
              className="zp-send"
              disabled={disabled || !custom.trim()}
              onClick={() => {
                if (!custom.trim()) return;
                onAct(personify(custom.trim(), name));
                setCustom("");
              }}
            >
              说出口
            </button>
          </div>
        </aside>
      </>
    );
  }

  // 看自己永远算「知根知底」——给主角打码是荒谬的（本轮实测踩过：
  // 因为 level=0 被判成 stranger，自己的「底细」「牵挂」全变成 ▨▨▨▨）
  const k = self ? "close" : knowledgeOf(level);
  const groups = self ? selfActionsFor() : actionGroupsFor(name);
  // 物品归属口径：主角的东西 owner 是「主角」，不是他的名字。按名字筛会得到空背包（实测）。
  const theirs = items.filter((i) => (i.owner || "主角") === (self ? "主角" : name));
  const mine = items.filter((i) => (i.owner || "主角") === "主角");
  // 探查所得并入随身清单（看清过的东西永久知情）；会话背包里已有的不重复列
  const seenInv = Array.isArray(sheet?.revealed?.inventory) ? sheet!.revealed!.inventory! : [];
  const knownNames = new Set(theirs.map((i) => i.name));
  const extraSeen = seenInv.filter((i) => i?.name && !knownNames.has(i.name));
  const brief = sheet?.background || fallbackBrief || "";
  // 探查看清过的人，底细不再打码（看清过的东西不会忘）
  const hasSeen = !!(sheet?.revealed?.insight || (sheet?.revealed?.inventory || []).length);
  const seal = deadSeal(sheet);
  const titleLine = [sheet?.role, sheet?.title, sheet?.age].filter(Boolean).join(" · ");
  const marked = !!sheet?.marked;

  const fire = (a: PersonAction) => onAct(a.text, a.verb);

  const fireDetail = (defaultText: string, verb?: string) => {
    onAct(detailText.trim() || defaultText, verb);
    setDetailKey(null);
    setDetailText("");
  };
  /** 群组动作的统一入口：细写开 → 展开编辑器；关 → 直接出手 */
  const actOn = (a: PersonAction) => {
    if (fineWrite && !self) { setDetailText(""); setDetailKey(`g:${a.label}`); return; }
    fire(a);
  };
  /** 论交三件同口径（默认句带人名） */
  const actOnPhrase = (key: string, defaultText: string) => {
    if (fineWrite) { setDetailText(""); setDetailKey(`x:${key}`); return; }
    onAct(defaultText);
  };
  /** 细写编辑器：可选输入 + 剧情选项 chips + 出手/算了。空输入 = 默认句直接出。 */
  const detailRow = (key: string, defaultText: string, verb?: string) => (
    <div className="zp-detail">
      <input
        className="zp-detail-input"
        autoFocus
        placeholder={`默认：${defaultText}`}
        value={detailText}
        onChange={(e) => setDetailText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") fireDetail(defaultText, verb);
          if (e.key === "Escape") { setDetailKey(null); setDetailText(""); }
        }}
      />
      {(suggestions || []).length > 0 && (
        <div className="zp-detail-chips">
          {(suggestions || []).slice(0, 3).map((s, si) => (
            <button key={si} className="zp-detail-chip" title={`${s}（点填入，可改后出手）`} onClick={() => setDetailText(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="zp-detail-ops">
        <button className="zp-detail-go" onClick={() => fireDetail(defaultText, verb)}>就这么办</button>
        <button className="zp-detail-no" onClick={() => { setDetailKey(null); setDetailText(""); }}>算了</button>
      </div>
      <p className="zp-detail-hint">空着不动 = 默认句直接出；写了就带着细节出手。</p>
    </div>
  );
  // 交谈：全卡主交互——点一下就与这个人聊起来（走 talk 动词，引擎按对话处理）
  const converse = () => onAct(personify(`与${name}交谈`, name), "talk");

  // 一键填充：把这张卡的空白字段交给 AI 补全（填表系统，从小说系统抄来）
  const doFill = async () => {
    if (filling) return;
    setFilling(true);
    setFillMsg(null);
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "补全失败");
      if (data.sheet) setSheet(data.sheet);
      const filled = Array.isArray(data.filled) ? data.filled : [];
      setFillMsg(filled.length ? `已补全：${filled.join("、")}` : (data.message || "档案已完整"));
    } catch (e: any) {
      setFillMsg(`填充失败：${e?.message || "未知错误"}`);
    } finally {
      setFilling(false);
    }
  };

  // 探查：判定来源是你自己（功法神通/情报），成败交给骰子，AI 只补探到的东西。
  // 回执全透明——探查力明细 + 骰面 + 档位，让玩家看见「这一把为什么是这个数」。
  const doInspect = async () => {
    if (inspecting || self) return;
    setInspecting(true);
    setInspectErr(null);
    setTab("overview"); // 回执出在概览页
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "探查失败");
      setInspectRes(data);
      if (data.verdict?.reveals?.background && data.insight) {
        // 看清过的东西永久知情：把洞察并进卡面（revealed 由服务端写入，这里同步本地视图）
        setSheet((prev) => (prev ? { ...prev, revealed: data.verdict ? {
          insight: data.insight,
          inventory: data.inventory || prev.revealed?.inventory,
        } : prev.revealed } : prev));
      }
    } catch (e: any) {
      setInspectErr(`探查失败：${e?.message || "未知错误"}`);
    } finally {
      setInspecting(false);
    }
  };

  // ── 头像：导入本地图片 / AI 生成（设置里可配置生图服务） ──
  const avatarUrl = sheet?.avatarVersion
    ? `/api/game/saga/${encodeURIComponent(sagaId)}/characters/avatar?name=${encodeURIComponent(name)}&v=${sheet.avatarVersion}`
    : null;

  const postAvatar = async (payload: { generate?: boolean; image?: string }, busy: "import" | "gen") => {
    if (avatarBusy) return;
    setAvatarBusy(busy);
    setAvatarMsg(null);
    try {
      const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ...payload }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || "头像保存失败");
      setSheet((prev) => (prev ? { ...prev, avatarVersion: data.avatarVersion } : prev));
      setAvatarMsg(busy === "gen" ? "立绘已成" : "头像已导入");
    } catch (e: any) {
      setAvatarMsg(`${busy === "gen" ? "生成失败" : "导入失败"}：${e?.message || "未知错误"}`);
    } finally {
      setAvatarBusy(null);
    }
  };

  const onPickAvatar = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 4 * 1024 * 1024) { setAvatarMsg("导入失败：图片超过 4MB"); return; }
    const reader = new FileReader();
    reader.onload = () => void postAvatar({ image: String(reader.result || "") }, "import");
    reader.readAsDataURL(f);
  };

  // ── 标记（鬼谷「标记」的等价物）：钉在名录上，找人不累 ──
  const patchSheet = async (patch: Record<string, unknown>) => {
    const res = await fetch(`/api/game/saga/${encodeURIComponent(sagaId)}/characters`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, patch }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error || "保存失败");
    if (data.sheet) setSheet(data.sheet);
    return data.sheet as CharacterSheet;
  };

  const toggleMark = async () => {
    if (savingMark) return;
    setSavingMark(true);
    try { await patchSheet({ marked: !marked }); } catch { /* 失败静默——标记不是关键操作 */ }
    finally { setSavingMark(false); }
  };

  const saveRelNote = async () => {
    try {
      await patchSheet({ relationNote: relNote.trim() });
      setRelSaved(true);
      setTimeout(() => setRelSaved(false), 2000);
    } catch { /* 失败静默 */ }
  };

  // ── 左栏动作（鬼谷式竖排）：交谈主按钮 + 三组细分 + 往来三件 + 标记 ──
  const railGo = (t: Tab) => setTab(t);

  return (
    <>
      <div className="zp-mask" onClick={onClose} />
      <aside className="zp-panel" role="dialog" aria-label={`${name} 的人物卡`}>
        {/* ── 头 ──（大立绘在左，名字/身份/印章在右） ── */}
        <header className="zp-head">
          <div className="zp-portrait-col">
            <div className={`zp-portrait${self ? " self" : ""}${avatarUrl ? " has-img" : ""}`}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={name} onError={(e) => { (e.target as HTMLElement).style.display = "none"; }} />
              ) : (
                <span>{self ? "我" : (name || "").slice(0, 1)}</span>
              )}
            </div>
            <div className="zp-portrait-ops">
              <button
                className="zp-avatar-btn"
                disabled={!!avatarBusy}
                onClick={() => fileRef.current?.click()}
                title="导入本地图片（PNG/JPG/WEBP，≤4MB）"
              >
                {avatarBusy === "import" ? "导入中…" : "导入"}
              </button>
              <button
                className="zp-avatar-btn gen"
                disabled={!!avatarBusy}
                onClick={() => void postAvatar({ generate: true }, "gen")}
                title="按档案生成立绘（生图服务在设置里配置）"
              >
                {avatarBusy === "gen" ? "生成中…" : "AI 生成"}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => { onPickAvatar(e.target.files?.[0]); e.target.value = ""; }}
            />
            {avatarMsg && <span className="zp-avatar-msg">{avatarMsg}</span>}
          </div>
          <div className="zp-head-main">
            <h2 className="zp-name">{marked && <em className="zp-mark-star">★</em>}{name}</h2>
            {titleLine && <p className="zp-title">{titleLine}</p>}
            {/* 退场死亡印章：垫后不删除，卡永远打得开 */}
            {seal && <span className="zp-dead-seal inline">{seal}</span>}
            {!self && (
              <div className="zp-rel-inline">
                <RelationScale level={level} />
                <span className="zp-rel-num">{level > 0 ? `+${level}` : level}</span>
                <span className="zp-rel-tier">{level === 0 ? "尚未打交道" : relationTier(level)}</span>
              </div>
            )}
            <p className="zp-know">{knowledgeLabel(k)}</p>
            {!self && sheet?.relationNote && <p className="zp-relnote">「{sheet.relationNote}」</p>}
          </div>
          <button className="zp-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        {/* ── 身：左栏动作 + 右侧档案页签（鬼谷式两栏） ── */}
        <div className="zp-body">
          {/* 左栏：对这个人能做的一切，一列排开；动词永远全在（好感只改难度不删选项） */}
          <nav className="zp-rail" aria-label="对此人的动作">
            {!self && (
              <>
                <button className="zp-rail-talk" disabled={disabled} onClick={converse}>交谈</button>
                {/* 细写开关（用户口径 2026-11-15）：固定动作默认一键出手不繁琐；开了之后
                    点动作先展开可选输入——空=默认句直接出，写了带细节出，剧情选项 chips 一键填 */}
                <button
                  className={`zp-rail-fine${fineWrite ? " on" : ""}`}
                  onClick={() => { setFineWrite((v) => !v); setDetailKey(null); }}
                  title="细写：点动作先展开可选输入（空=默认句直接出；可把本轮剧情选项一键填进来，也可自己写）"
                >
                  {fineWrite ? "细写 · 开" : "细写"}
                </button>
                {groups.map((g) => (
                  <div className="zp-rail-sect" key={g.tone}>
                    <span className={`zp-rail-tag ${g.tone}`}>{g.label}</span>
                    {g.actions.map((a) => (
                      <div key={a.label} className="zp-rail-wrap">
                        <button
                          className={`zp-rail-btn${a.risk === "deadly" ? " deadly" : a.risk === "risky" ? " risky" : ""}${detailKey === `g:${a.label}` ? " open" : ""}`}
                          disabled={disabled}
                          onClick={() => actOn(a)}
                          title={`${a.text}${a.cost ? `（${a.cost}）` : ""}`}
                        >
                          {a.label}
                        </button>
                        {detailKey === `g:${a.label}` && detailRow(`g:${a.label}`, a.text, a.verb)}
                      </div>
                    ))}
                  </div>
                ))}
                <div className="zp-rail-sect">
                  <span className="zp-rail-tag deal">往来</span>
                  <button className="zp-rail-btn" disabled={disabled || inspecting} onClick={doInspect} title="判定来源是你自己的神识功法与情报；骰面回执出在概览页">
                    {inspecting ? "探查中…" : hasSeen ? "再探查" : "探查"}
                  </button>
                  <button className="zp-rail-btn" disabled={disabled} onClick={() => railGo("carry")} title="送他一件东西（随身页里点物品）">送物</button>
                  <button className="zp-rail-btn risky" disabled={disabled} onClick={() => railGo("carry")} title="摸他一件东西（随身页里点物品）">摸物</button>
                  {/* 论交三件（鬼谷同源）：正和博弈——成了双方长脸，输了不结死仇（好感走 verbs 查表） */}
                  <div className="zp-rail-wrap">
                    <button className={`zp-rail-btn${detailKey === "x:切磋" ? " open" : ""}`} disabled={disabled} onClick={() => actOnPhrase("切磋", `与${name}切磋一番，点到为止`)} title="以武会友 · 成了+4（不打不相识），失手-3">切磋</button>
                    {detailKey === "x:切磋" && detailRow("x:切磋", `与${name}切磋一番，点到为止`)}
                  </div>
                  <div className="zp-rail-wrap">
                    <button className={`zp-rail-btn${detailKey === "x:论道" ? " open" : ""}`} disabled={disabled} onClick={() => actOnPhrase("论道", `与${name}论道一场，各抒己见`)} title="以言会友 · 相谈甚欢+3，不欢而散-1">论道</button>
                    {detailKey === "x:论道" && detailRow("x:论道", `与${name}论道一场，各抒己见`)}
                  </div>
                  <div className="zp-rail-wrap">
                    <button className={`zp-rail-btn${detailKey === "x:教诲" ? " open" : ""}`} disabled={disabled} onClick={() => actOnPhrase("教诲", `向${name}授业解惑一番`)} title="传道之谊 · 他受教+2，不领情-2">教诲</button>
                    {detailKey === "x:教诲" && detailRow("x:教诲", `向${name}授业解惑一番`)}
                  </div>
                </div>
                <div className="zp-rail-sect">
                  <span className="zp-rail-tag deal">惯用招</span>
                  {extSlots.map((s) => {
                    const label = (s.label || "").trim();
                    const text = (s.text || "").trim();
                    if (!label && !text) return null;
                    return (
                      <button
                        key={s.slot}
                        className="zp-rail-btn"
                        disabled={disabled}
                        title={personify(text || label, name)}
                        onClick={() => onAct(personify(text || label, name))}
                      >
                        {label || text.slice(0, 4)}
                      </button>
                    );
                  })}
                  {onExtChange && (
                    <button className="zp-rail-btn edit" onClick={() => setEditExt((v) => !v)}>
                      {editExt ? "收起" : "改招"}
                    </button>
                  )}
                </div>
                <div className="zp-rail-sect">
                  <span className="zp-rail-tag deal">记号</span>
                  <button className={`zp-rail-btn${marked ? " marked" : ""}`} disabled={savingMark} onClick={toggleMark} title="钉在名录上，名单里加星">
                    {marked ? "已标记" : "标记"}
                  </button>
                </div>
              </>
            )}
            {self && groups.map((g) => (
              <div className="zp-rail-sect" key={g.tone}>
                <span className={`zp-rail-tag ${g.tone}`}>{g.label}</span>
                {g.actions.map((a) => (
                  <button key={a.label} className="zp-rail-btn" disabled={disabled} onClick={() => fire(a)} title={a.text}>
                    {a.label}
                  </button>
                ))}
              </div>
            ))}
            {editExt && onExtChange && (
              <div className="zp-ext-panel">
                {extSlots.map((s) => (
                  <div className="zp-ext-row" key={s.slot}>
                    <input
                      value={s.label}
                      maxLength={8}
                      placeholder="按钮字"
                      onChange={(e) =>
                        onExtChange(extSlots.map((x) => (x.slot === s.slot ? { ...x, label: e.target.value } : x)))
                      }
                    />
                    <input
                      value={s.text}
                      maxLength={60}
                      placeholder="真说出口的话（他/她会换成名字）"
                      onChange={(e) =>
                        onExtChange(extSlots.map((x) => (x.slot === s.slot ? { ...x, text: e.target.value } : x)))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </nav>

          {/* 右栏：档案页签（详细情报一页页进；页签内容独立滚动） */}
          <div className="zp-main">
            <div className="zp-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`zp-tab${tab === t.key ? " on" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="zp-tabbody">
              {/* ── 概览：状态 + 属性速览 + 探查回执 ── */}
              {tab === "overview" && (
                <div className="zp-sect">
                  {sheet?.status && (
                    <div className="zp-status">
                      {typeof sheet.status.hp === "number" && (
                        <div className="zp-stat">
                          <span className="zp-stat-k">体力</span>
                          <span className="zp-stat-bar">
                            {Array.from({ length: 10 }, (_, i) => (
                              <i key={i} className={i < Math.round((sheet.status!.hp || 0) / 10) ? "on hp" : ""} />
                            ))}
                          </span>
                          <span className="zp-stat-n">{sheet.status.hp}</span>
                        </div>
                      )}
                      {typeof sheet.status.spirit === "number" && (
                        <div className="zp-stat">
                          <span className="zp-stat-k">精神</span>
                          <span className="zp-stat-bar">
                            {Array.from({ length: 10 }, (_, i) => (
                              <i key={i} className={i < Math.round((sheet.status!.spirit || 0) / 10) ? "on sp" : ""} />
                            ))}
                          </span>
                          <span className="zp-stat-n">{sheet.status.spirit}</span>
                        </div>
                      )}
                      <div className="zp-stat-tags">
                        {sheet.status.injury && <span className="zp-tag inj">{sheet.status.injury}</span>}
                        {sheet.status.mood && <span className="zp-tag mood">{sheet.status.mood}</span>}
                        {sheet.status.location && <span className="zp-tag loc">{sheet.status.location}</span>}
                      </div>
                    </div>
                  )}
                  <div className="zp-fields">
                    <Field label="为人" value={sheet?.personality} />
                    <Field label="外貌" value={sheet?.appearance} />
                    <Field label="底细" value={brief} masked={shouldMask(brief, k) && !hasSeen} />
                    {!self && sheet?.revealed?.insight && <Field label="洞察" value={sheet.revealed.insight} />}
                  </div>
                  {k === "stranger" && (brief || sheet?.notes) && !hasSeen && (
                    <p className="zp-hint">再打几次交道，才看得清他的底。左栏「探查」也可以——看的是你自己的本事。</p>
                  )}
                  {inspectErr && <p className="zp-fill-msg">{inspectErr}</p>}
                  {inspectRes && (
                    <div className={`zp-inspect t-${inspectRes.verdict.tier}`}>
                      <div className="zp-inspect-dice">
                        <span className="zp-inspect-tier">{tierLabel(inspectRes.verdict.tier)}</span>
                        <span className="zp-inspect-num">骰 {inspectRes.verdict.d100} ／ 率 {inspectRes.verdict.rate}</span>
                      </div>
                      <div className="zp-inspect-parts">
                        {inspectRes.verdict.parts.map((p, i) => (
                          <span key={i} className="zp-inspect-part">{p.label} +{p.value}</span>
                        ))}
                      </div>
                      <p className="zp-inspect-note">{inspectRes.verdict.note}</p>
                      {inspectRes.verdict.alertDelta !== 0 && (
                        <p className="zp-inspect-alert">被察觉 · 好感 {inspectRes.verdict.alertDelta}</p>
                      )}
                      {inspectRes.insight && <p className="zp-inspect-insight">洞察：{inspectRes.insight}</p>}
                      {inspectRes.inventory && inspectRes.inventory.length > 0 && (
                        <div className="zp-chips">
                          {inspectRes.inventory.map((i, idx) => (
                            <span key={idx} className="zp-chip seen" title={i.desc || undefined}>
                              {i.name}
                              {i.desc ? <em>{i.desc}</em> : null}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── 底细：故事 + 牵挂 + 一键填充（详细设定在这一页） ── */}
              {tab === "detail" && (
                <div className="zp-sect">
                  <div className="zp-fields">
                    <Field label="底细" value={brief} masked={shouldMask(brief, k) && !hasSeen} />
                    {!self && sheet?.revealed?.insight && <Field label="洞察" value={sheet.revealed.insight} />}
                    <Field label="牵挂" value={sheet?.notes} masked={shouldMask(sheet?.notes, k)} />
                  </div>
                  {k === "stranger" && (brief || sheet?.notes) && !hasSeen && (
                    <p className="zp-hint">关系不够，看不清他的底——打码的部分是「他不让陌生人知道的事」。</p>
                  )}
                  <div className="zp-fill">
                    <button className="zp-fill-btn" disabled={disabled || filling} onClick={doFill}>
                      {filling ? "补全中…" : "一键填充档案"}
                    </button>
                    {fillMsg && <span className="zp-fill-msg">{fillMsg}</span>}
                  </div>
                </div>
              )}

              {/* ── 随身：他身上有什么 + 送/摸（点物品即动手） ── */}
              {tab === "carry" && (
                <div className="zp-sect">
                  <p className="zp-sect-h">他身上<span>{theirs.length + extraSeen.length > 0 ? `　${theirs.length + extraSeen.length} 件` : self ? "　（你自己的背包）" : "　看不出来"}</span></p>
                  {theirs.length + extraSeen.length === 0 ? (
                    <p className="zp-empty">
                      {self ? "身上没带什么。" : "两手空空——也可能只是没让你看见。左栏「探查」能看清一些。"}
                    </p>
                  ) : (
                    <div className="zp-chips">
                      {theirs.map((i, idx) => (
                        <span key={idx} className="zp-chip">
                          {i.name}
                          {i.quantity > 1 && <em>×{i.quantity}</em>}
                          {i.damaged && <s>损</s>}
                          {i.equipped && <s className="eq">用</s>}
                        </span>
                      ))}
                      {extraSeen.map((i, idx) => (
                        <span key={`s${idx}`} className="zp-chip seen" title={i.desc || "探查所得"}>
                          {i.name}
                          <s className="probe">探</s>
                        </span>
                      ))}
                    </div>
                  )}
                  {!self && (
                    <>
                      <p className="zp-sect-h">送他<span>　点你背包里的东西即出手</span></p>
                      {mine.length === 0 ? (
                        <p className="zp-empty">你身上没有可送的东西。</p>
                      ) : (
                        <div className="zp-chips">
                          {mine.map((i, idx) => (
                            <button
                              key={idx}
                              className="zp-chip give"
                              disabled={disabled}
                              onClick={() => onAct(`把「${i.name}」赠予${name}`, "gift")}
                            >
                              {i.name}{i.quantity > 1 && <em>×{i.quantity}</em>}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="zp-sect-h">摸他<span>　有险——好感 -6 起步，被抓更难看</span></p>
                      {theirs.length + extraSeen.length === 0 ? (
                        <p className="zp-empty">还不知道他身上有什么——先探查，才知道值得摸什么。</p>
                      ) : (
                        <div className="zp-chips">
                          {[...theirs, ...extraSeen.map((i) => ({ name: i.name, quantity: 1 }))].map((i, idx) => (
                            <button
                              key={idx}
                              className="zp-chip give"
                              disabled={disabled}
                              onClick={() => onAct(`趁${name}不注意，把「${i.name}」摸走`, "steal")}
                            >
                              {i.name}{i.quantity > 1 && <em>×{i.quantity}</em>}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  {self && (
                    <>
                      <p className="zp-sect-h">你的背包<span>　{mine.length} 件</span></p>
                      {mine.length === 0 ? (
                        <p className="zp-empty">空空如也。</p>
                      ) : (
                        <div className="zp-chips">
                          {mine.map((i, idx) => (
                            <span key={idx} className="zp-chip">
                              {i.name}{i.quantity > 1 && <em>×{i.quantity}</em>}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── 关系：他的关系网 + 你定义的关系（鬼谷「定义关系」的等价物） ── */}
              {tab === "relations" && (
                <div className="zp-sect">
                  {sheet?.relations && sheet.relations.length > 0 ? (
                    <>
                      <p className="zp-sect-h">牵涉<span>　{sheet.relations.length} 人</span></p>
                      <div className="zp-chips">
                        {sheet.relations.map((r, idx) => (
                          <span key={idx} className="zp-chip rel">
                            {r.name}<em>{r.relation}</em>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="zp-empty">档案里还没记他与谁有牵涉。</p>
                  )}
                  <p className="zp-sect-h">你与他<span>　自己记，AI 也会看见</span></p>
                  <div className="zp-relnote-row">
                    <input
                      className="zp-input"
                      value={relNote || sheet?.relationNote || ""}
                      placeholder={`你和${name}是什么关系（如：过命的交情 / 杀父之仇）`}
                      maxLength={30}
                      disabled={disabled}
                      onChange={(e) => { setRelNote(e.target.value); setRelSaved(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") void saveRelNote(); }}
                    />
                    <button className="zp-send" disabled={disabled} onClick={() => void saveRelNote()}>
                      {relSaved ? "已记 ✓" : "记下"}
                    </button>
                  </div>
                  <p className="zp-hint">这是你自己下的定义——写进档案，AI 后续按这个关系演。</p>
                </div>
              )}

              {/* ── 本事：功法神通（检定时按它给探查/判定加成） ── */}
              {tab === "skills" && (
                <div className="zp-sect">
                  {sheet?.abilities && sheet.abilities.length > 0 ? (
                    <div className="zp-chips">
                      {sheet.abilities.map((a, idx) => (
                        <span key={idx} className="zp-chip">{a}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="zp-empty">档案里没记他会什么——底细页「一键填充」可补。</p>
                  )}
                  {!self && (
                    <p className="zp-hint">探查他时，你自己的本事（这一页是**他的**）决定看多清。</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 自己写一句：自由输入永远在底部，永远不被拒绝 ── */}
        <div className="zp-write">
          <input
            className="zp-input"
            value={custom}
            placeholder={`对${name}做什么，直接写`}
            disabled={disabled}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim()) {
                onAct(personify(custom.trim(), name));
                setCustom("");
              }
            }}
          />
          <button
            className="zp-send"
            disabled={disabled || !custom.trim()}
            onClick={() => {
              if (!custom.trim()) return;
              onAct(personify(custom.trim(), name));
              setCustom("");
            }}
          >
            说出口
          </button>
        </div>

        <p className="zp-foot">
          {riskLabel("deadly") === "必翻脸" ? "动作标「必翻脸」的，做完他会记着。" : ""}
        </p>
      </aside>
    </>
  );
}
