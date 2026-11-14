"use client";

/**
 * PersonPanel —— 人物卡（对某个人能做的一切，都在这一张卡上）
 *
 * 为什么要有它（2026-11-14 玩家反馈）：
 *   「辱骂、试探、威胁是针对某一个角色的。但整体上有点太多了，
 *     因为下面有可往之处，加上之前一大堆 UI，正文地方的 UI 太多了。
 *     可以在角色那里点开某一个角色卡，一边查看他的信息，一边也可以去触发这些效果。」
 *
 * 所以：正文区只留「可往之处」+ 输入框。所有**对人**的动作搬进这张卡。
 *
 * 抄鬼谷八荒的地方（三处）：
 *   1. 信息与动作同屏——查看与下手不分两步；
 *   2. 属性分栏读（身份/为人/外貌/底细/牵挂/身上/关系），不是一大段散文；
 *   3. 看不清就真的看不清（好感不够时「底细/牵挂」打码）——这是鬼谷「念力」的等价物。
 *
 * 不抄的地方：鬼谷用好感**锁**动作（结义/结缘要门槛）。本项目铁律是好感只改难度，
 * 永远不删选项——你可以对陌生人动手，只是你不知道他怀里有什么、背后有谁。
 *
 * 数据：GET /api/game/saga/[sagaId]/characters（人物卡正文）；
 *       好感来自 saga.relations（父级传入 level）；背包来自会话 items（按 owner 过滤）。
 */

import { useEffect, useState } from "react";
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
import type { ExtendedAction } from "@/core/game/verbs";
import type { CharacterSheet } from "./CharacterSheetPanel";

interface SheetItem {
  name: string;
  quantity: number;
  owner?: string;
  category?: string;
  damaged?: boolean;
  equipped?: boolean;
}

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
  /** 改六格（编辑器在卡里，正文区不再放这套 UI） */
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
  open, name, sagaId, level, items, extSlots, disabled, fallbackBrief, isSelf, onAct, onExtChange, onClose,
}: Props) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [showGive, setShowGive] = useState(false);
  const [editExt, setEditExt] = useState(false);
  const [custom, setCustom] = useState("");
  const [filling, setFilling] = useState(false);
  const [fillMsg, setFillMsg] = useState<string | null>(null);

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
    if (!open) { setShowGive(false); setCustom(""); setFillMsg(null); }
  }, [open]);

  // 换人时清掉上一轮填充反馈
  useEffect(() => { setFillMsg(null); }, [name]);

  if (!open || !name) return null;

  // 「点开的是不是我自己」：saga.playAsName 可能为 null（实测某些存档进游戏时没写），
  // 所以以人物卡里的 isPlayer 为准，prop 只作兜底。
  const self = !!isSelf || !!sheet?.isPlayer;
  // 看自己永远算「知根知底」——给主角打码是荒谬的（本轮实测踩过：
  // 因为 level=0 被判成 stranger，自己的「底细」「牵挂」全变成 ▨▨▨▨）
  const k = self ? "close" : knowledgeOf(level);
  const groups = self ? selfActionsFor() : actionGroupsFor(name);
  // 物品归属口径：主角的东西 owner 是「主角」，不是他的名字。按名字筛会得到空背包（实测）。
  const theirs = items.filter((i) => (i.owner || "主角") === (self ? "主角" : name));
  const mine = items.filter((i) => (i.owner || "主角") === "主角");
  const brief = sheet?.background || fallbackBrief || "";
  const titleLine = [sheet?.role, sheet?.title, sheet?.age].filter(Boolean).join(" · ");

  const fire = (a: PersonAction) => onAct(a.text, a.verb);

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

  return (
    <>
      <div className="zp-mask" onClick={onClose} />
      <aside className="zp-panel" role="dialog" aria-label={`${name} 的人物卡`}>
        {/* ── 头 ── */}
        <header className="zp-head">
          {/* 头像位：现在留空框，以后接人物立绘。尺寸/边框已定，接图时不用改版 */}
          <div className={`zp-portrait${self ? " self" : ""}`} aria-hidden>
            <span>{self ? "我" : (name || "").slice(0, 1)}</span>
          </div>
          <div className="zp-head-main">
            <h2 className="zp-name">{name}</h2>
            {titleLine && <p className="zp-title">{titleLine}</p>}
          </div>
          <button className="zp-close" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        {/* ── 关系：这是全卡最该被一眼看到的东西（对自己没有好感这回事） ── */}
        {!self && (
        <div className="zp-relation">
          <div className="zp-rel-row">
            <span className="zp-rel-k">好感</span>
            <RelationScale level={level} />
            <span className="zp-rel-num">{level > 0 ? `+${level}` : level}</span>
            <span className="zp-rel-tier">{level === 0 ? "尚未打交道" : relationTier(level)}</span>
          </div>
          <p className="zp-know">{knowledgeLabel(k)}</p>
        </div>
        )}

        {/* 一键填充：把空白档案项交给 AI 补全（填表系统，从小说系统抄来） */}
        <div className="zp-fill">
          <button className="zp-fill-btn" disabled={disabled || filling} onClick={doFill}>
            {filling ? "补全中…" : "一键填充档案"}
          </button>
          {fillMsg && <span className="zp-fill-msg">{fillMsg}</span>}
        </div>

        {/* ── 状态：只有自己才有「体力/精神」这种东西 ── */}
        {self && sheet?.status && (
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

        {/* ── 信息栏 ── */}
        <div className="zp-fields">
          <Field label="为人" value={sheet?.personality} />
          <Field label="外貌" value={sheet?.appearance} />
          <Field label="底细" value={brief} masked={shouldMask(brief, k)} />
              <Field label="牵挂" value={sheet?.notes} masked={shouldMask(sheet?.notes, k)} />
          {sheet?.abilities && sheet.abilities.length > 0 && (
            <Field label="本事" value={sheet.abilities.join(" · ")} />
          )}
          {k === "stranger" && (brief || sheet?.notes) && (
            <p className="zp-hint">再打几次交道，才看得清他的底。</p>
          )}
        </div>

        {/* ── 身上 ── */}
        <div className="zp-sect">
          <p className="zp-sect-h">身上<span>{theirs.length > 0 ? `　${theirs.length} 件` : self ? "　空" : "　看不出来"}</span></p>
          {theirs.length === 0 ? (
            <p className="zp-empty">
              {self ? "身上没带什么。" : "两手空空——也可能只是没让你看见。"}
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
            </div>
          )}
        </div>

        {/* ── 关系网 ── */}
        {sheet?.relations && sheet.relations.length > 0 && (
          <div className="zp-sect">
            <p className="zp-sect-h">牵涉<span>　{sheet.relations.length} 人</span></p>
            <div className="zp-chips">
              {sheet.relations.map((r, idx) => (
                <span key={idx} className="zp-chip rel">
                  {r.name}<em>{r.relation}</em>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 你能对他做的 ── */}
        <div className="zp-actions">
          <p className="zp-sect-h">{self ? "你能对自己做的" : "你能对他做的"}</p>
          {/* 交谈：鬼谷八荒式主按钮——先有「聊」这个入口，下面才是细分动作 */}
          {!self && (
            <button className="zp-talk" disabled={disabled} onClick={converse}>
              与{name}交谈
            </button>
          )}
          {groups.map((g) => (
            <div className="zp-act-group" key={g.tone}>
              <span className={`zp-act-tag ${g.tone}`}>{g.label}</span>
              <div className="zp-act-list">
                {g.actions.map((a) => (
                  <button
                    key={a.label}
                    className={`zp-act${a.risk === "deadly" ? " deadly" : a.risk === "risky" ? " risky" : ""}`}
                    disabled={disabled}
                    onClick={() => fire(a)}
                    title={`${a.text}${a.cost ? `（${a.cost}）` : ""}`}
                  >
                    {a.label}
                    <em>{a.cost}</em>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── 送点什么（自己送自己没意义，isSelf 整块不渲染） ── */}
        {!self && (
        <div className="zp-sect">
          <button
            className="zp-give-btn"
            disabled={disabled}
            onClick={() => setShowGive((v) => !v)}
          >
            {showGive ? "收起" : `送 ${name} 一件东西`}
          </button>
          {showGive && (
            mine.length === 0 ? (
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
            )
          )}
        </div>
        )}

        {/* ── 你的六格（原来挤在正文输入框下面，现在归位；对自己没有对象可言） ── */}
        {!self && (
        <div className="zp-sect">
          <p className="zp-sect-h">
            你的惯用招<span>　点一下就说出口</span>
            {onExtChange && (
              <button className="zp-ext-edit" onClick={() => setEditExt((v) => !v)}>
                {editExt ? "收起" : "改"}
              </button>
            )}
          </p>
          <div className="zp-ext">
            {extSlots.map((s) => {
              const label = (s.label || "").trim();
              const text = (s.text || "").trim();
              if (!label && !text) return null;
              return (
                <button
                  key={s.slot}
                  className="zp-ext-btn"
                  disabled={disabled}
                  title={personify(text || label, name)}
                  onClick={() => onAct(personify(text || label, name))}
                >
                  {label || text.slice(0, 4)}
                </button>
              );
            })}
          </div>
          {editExt && onExtChange && (
            <div className="zp-ext-panel">
              {extSlots.map((s) => (
                <div className="zp-ext-row" key={s.slot}>
                  <input
                    value={s.label}
                    maxLength={8}
                    placeholder="按钮上的字"
                    onChange={(e) =>
                      onExtChange(extSlots.map((x) => (x.slot === s.slot ? { ...x, label: e.target.value } : x)))
                    }
                  />
                  <input
                    value={s.text}
                    maxLength={60}
                    placeholder="真说出口的那句话（他/她会换成对方名字）"
                    onChange={(e) =>
                      onExtChange(extSlots.map((x) => (x.slot === s.slot ? { ...x, text: e.target.value } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {/* ── 自己写一句 ── */}
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
