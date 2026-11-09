"use client";

/**
 * 游戏本详情（F6 跑团化 P0-1a + 两段式骰子 + 完整游戏面板）
 * 章节体系（一章一局）+ 游戏循环（流式开场 / 选项 / 行动 / 收束归档）。
 * 骰子两段式：对抗行动先掷骰（悬浮动画+可重骰），点「继续」才生成叙事——动画不阻塞页面操作。
 *
 * 面板移植（与旧游戏模式同源引擎，数据来自同一套 GameSession）：
 * - 左栏：情节进度（轮次）/ 角色 / 势力
 * - 右栏：正文进度 / 背包（四类分组+新物品高亮+音效+使用装备）/ 世界（世界观+世界书+章纲）
 * - 及时演算：token 流中 NE|/CI| 标记实时解析，发现/物品变动即时上屏（不再等轮末）
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";
import { CharacterSheetPanel } from "@/components/game/saga/CharacterSheetPanel";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { isConfrontationalAction } from "@/core/game/game-prompts";
import { applyFrontendItemChanges } from "@/core/game/reconcile";
import GameParticles, { type GameParticlesHandle } from "@/components/game/GameParticles";

interface SagaChapter {
  id: string;
  index: number;
  title: string;
  outline: string | null;
  status: string; // active | archived
  wordCount: number;
  sessionId: string | null;
  sessionStatus: string | null;
  sessionRound: number;
  sessionWords: number;
}
interface SagaDetail {
  id: string;
  title: string;
  projectId: string | null;
  sourceBookName: string | null;
  synopsis: string;
  loreEntries: Array<{ title: string; content: string }>;
  /** 热点名候选（P1）：项目/快照全部角色卡名——NE| 漏打时正文人名仍可点 */
  hotspotNames: string[];
  playAsCharacterId: string | null;
  playAsName: string | null;
  /** 叙事视点：first 第二人称亲历 | third 第三人称小说镜头 | god 群像上帝/GM */
  narrativeMode: string;
  /** 暗线账本：仅上帝/GM 视角返回真相（其他视角为空数组） */
  secretLedger: Array<{ name: string; owner: string; truth: string; round: number }>;
  rollMode: string;
  rollDifficulty: string;
  playAsCandidates: Array<{ id: string | null; name: string; role: string; brief: string }>;
  chapters: SagaChapter[];
}
interface GameOption { index: number; text: string; }
/** 背包物品（与引擎 applyItemChanges 产物同形） */
interface GItem {
  name: string;
  quantity: number;
  category?: string; // consumable | equipment | quest | currency | other
  source?: string;
  owner?: string;
  equipped?: boolean;
  damaged?: boolean; // P1：受损（仍存在，可修复/藏内情）
}
/** 场景实体（角色/势力/地点/生物） */
interface GEntity { name: string; type: string; description: string; }
interface TurnRec { round: number; playerAction: string; narrative: string; }
/** 两段式骰子浮层状态 */
interface DiceState {
  rolling: boolean;
  result: { d100: number; label: string; successRate: number; reasons: string[]; rerollsLeft: number; rerollMax: number } | null;
}

const LEFT_TABS = [
  { key: "plot", label: "情节", icon: "book" },
  { key: "characters", label: "角色", icon: "user" },
  { key: "factions", label: "势力", icon: "building" },
] as const;
const RIGHT_TABS = [
  { key: "text", label: "正文", icon: "file" },
  { key: "backpack", label: "背包", icon: "backpack" },
  { key: "world", label: "世界", icon: "globe" },
] as const;
const QUICK_ACTIONS = [
  { type: "observe", label: "观察", icon: "search", desc: "观察环境/人物" },
  { type: "dialogue", label: "对话", icon: "message", desc: "与角色交谈" },
  { type: "combat", label: "战斗", icon: "sword", desc: "进入战斗" },
  { type: "explore", label: "探索", icon: "map", desc: "探索新区域" },
  { type: "use_item", label: "使用物品", icon: "backpack", desc: "使用背包物品" },
  { type: "rest", label: "休息", icon: "moon", desc: "休息恢复" },
];
/** 上帝/GM 的导演编排项：点击把半成品编排填进输入框，补一句就发（不直接消耗一轮） */
const GM_ACTIONS = [
  { fill: "【推进时间】时间推进到 ", icon: "hourglass", label: "推进时间", desc: "让时间/局势向前走一段" },
  { fill: "【切换镜头】把镜头切到 ", icon: "eye", label: "切镜头", desc: "把镜头交给另一个人或另一个地方" },
  { fill: "【制造意外】突然发生：", icon: "sparkles", label: "制造意外", desc: "在当下抛出一个变故" },
  { fill: "【旁人视角】与此同时，另一边：", icon: "user", label: "旁人视角", desc: "写此刻别人在做什么" },
  { fill: "【多线并行】两条线同时推进：", icon: "gitBranch", label: "多线并行", desc: "同一轮里推进两条线索" },
];

/**
 * 万物可交互（语义热点）：把叙事中的实体/物品名渲染为可点击热点，
 * 点击直接发起「观察：X」行动——正文里的世界不再只是文字。
 * 名字按长度降序匹配（避免短名抢先命中），两字以下不参与（误匹配率高）。
 */
function renderHotspots(text: string, names: string[], onPick: (name: string) => void) {
  if (!text) return null;
  const uniq = [...new Set(names.filter((n) => n && n.length >= 2))].sort((a, b) => b.length - a.length);
  if (uniq.length === 0) return text;
  const escaped = uniq.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${escaped})`, "g"));
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <button
        key={i}
        onClick={() => onPick(p)}
        title={`点击发起行动：观察 ${p}`}
        className="game-hotspot mx-px rounded px-0.5 text-[#E4B863] underline decoration-dotted underline-offset-2 transition-colors hover:bg-[#E4B863]/15"
      >
        {p}
      </button>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

/**
 * 流式显示截断：结构区块（===新实体/角色物品变动/暗线===、【情节进度】）都在正文之后，
 * 出现即截断——暗线（TRICK|…）绝不能在流式期闪现给玩家（轮末 parse 只对落库正文生效）。
 */
function hideStructBlocks(raw: string) {
  const idx = raw.search(/(===|【情节进度)/);
  return idx >= 0 ? raw.slice(0, idx) : raw;
}

function SagaDetailInner() {
  const { sagaId } = useParams<{ sagaId: string }>();
  const router = useRouter();

  const [saga, setSaga] = useState<SagaDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  // 轻量游戏循环状态
  const [activeChapter, setActiveChapter] = useState<SagaChapter | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "playing">("idle");
  /** 正在结束本章（AI 写收尾中）—— 用来给按钮单独显示进度，不与普通回合生成混淆 */
  const [endingChapter, setEndingChapter] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [streamed, setStreamed] = useState("");
  const [options, setOptions] = useState<GameOption[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterOutline, setChapterOutline] = useState("");
  const [showNewChapter, setShowNewChapter] = useState(false);
  // 骰子结果卡（跑团模式，P0-4 + 检定官明细）
  const [rollInfo, setRollInfo] = useState<{ d100: number; label: string; successRate?: number; reasons?: string[] } | null>(null);
  // 两段式骰子浮层（悬浮动画 + 重骰 + 继续）
  const [dice, setDice] = useState<DiceState | null>(null);
  const [diceTick, setDiceTick] = useState(0);
  const streamRef = useRef<AbortController | null>(null);

  // ── 游戏面板状态（移植自旧游戏模式，数据源 = 同一引擎的 SSE 事件）──
  const [round, setRound] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [plotProgress, setPlotProgress] = useState(0);
  const [entities, setEntities] = useState<GEntity[]>([]);
  const [items, setItems] = useState<GItem[]>([]);
  const [turns, setTurns] = useState<TurnRec[]>([]);
  const [leftTab, setLeftTab] = useState<"plot" | "characters" | "factions">("plot");
  const [rightTab, setRightTab] = useState<"text" | "backpack" | "world">("text");
  const [backpackFilter, setBackpackFilter] = useState<"all" | "mine" | "companions">("all");
  const [showTutorial, setShowTutorial] = useState(false);

  // 发现提示（及时演算）+ 新物品高亮 + 粒子 + 音效
  const particlesRef = useRef<GameParticlesHandle>(null);
  const discoveryIdRef = useRef(0);
  const [discoveries, setDiscoveries] = useState<Array<{ id: number; label: string }>>([]);
  const [newItemKeys, setNewItemKeys] = useState<Set<string>>(new Set());
  const newItemKeysRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 及时演算扫描缓冲：token 流按行解析 NE|/CI| 标记（不完整行留在缓冲）
  const markBufRef = useRef("");
  const firedMarksRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setSaga(data.saga);
      // 首次进入且还没有角色卡档案、但存在可确认的角色：自动打开「我的角色」让你确认/填写
      // （上帝视角不扮演任何人，不弹）
      if (data.saga && data.saga.hasCharacterSheets === false
        && data.saga.narrativeMode !== "god"
        && (data.saga.playAsName || (data.saga.playAsCandidates || []).length > 0)
        && !sheetPromptedRef.current) {
        sheetPromptedRef.current = true;
        setSheetName(data.saga.playAsName || null);
        setSheetOpen(true);
      }
    } catch {
      setNotFound(true);
    }
  }, [sagaId]);

  useEffect(() => { load(); }, [load]);

  // 骰子滚动期：数字快速跳动（不知道结果——等它判定的爽感）
  useEffect(() => {
    if (!dice?.rolling) return;
    const t = setInterval(() => setDiceTick(1 + Math.floor(Math.random() * 100)), 90);
    return () => clearInterval(t);
  }, [dice?.rolling]);

  // 物品获得提示音（WebAudio，首次用户手势后可用）
  const playItemChime = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      const ac = audioCtxRef.current;
      if (ac.state === "suspended") void ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(740, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(1180, ac.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.34);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.36);
    } catch {
      /* 静默：部分浏览器禁用音频时不影响游戏 */
    }
  }, []);

  // 发现提示上屏：pill + 粒子爆发（香槟金，与旧游戏模式同款）
  const fireDiscovery = useCallback((label: string) => {
    particlesRef.current?.emitBurst({ color: "#E4B863", count: 12 });
    const id = ++discoveryIdRef.current;
    setDiscoveries((prev) => [...prev, { id, label }]);
    setTimeout(() => setDiscoveries((prev) => prev.filter((d) => d.id !== id)), 3200);
  }, []);

  // 新物品高亮 + 音效 + 自动切到背包页
  const flagNewItems = useCallback((prevItems: GItem[], nextItems: GItem[]) => {
    const prevKeys = new Set(prevItems.map((i) => `${i.name}|${i.owner || "主角"}`));
    const added = nextItems.filter((i) => !prevKeys.has(`${i.name}|${i.owner || "主角"}`));
    if (added.length === 0) return;
    playItemChime();
    for (const it of added) {
      const key = `${it.name}|${it.owner || "主角"}`;
      newItemKeysRef.current = new Set(newItemKeysRef.current).add(key);
      setNewItemKeys(new Set(newItemKeysRef.current));
      setTimeout(() => {
        newItemKeysRef.current = new Set([...newItemKeysRef.current].filter((k) => k !== key));
        setNewItemKeys(new Set(newItemKeysRef.current));
      }, 2600);
    }
    setRightTab("backpack");
  }, [playItemChime]);

  // ── 及时演算核心：token 流中实时解析 NE|/CI| 标记行 ──
  // 引擎输出约定：NE|实体名|类型|简要描述；CI|获得|物品名|数量|归属（可选）；CI|消耗/装备/丢弃|物品名|数量
  const scanGameMarks = useCallback((chunk: string) => {
    markBufRef.current += chunk;
    const lines = markBufRef.current.split("\n");
    markBufRef.current = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("NE|")) {
        const parts = line.split("|").map((s) => s.trim());
        const name = parts[1];
        const type = parts[2] || "实体";
        if (!name || firedMarksRef.current.has(`NE|${name}`)) continue;
        firedMarksRef.current.add(`NE|${name}`);
        fireDiscovery(`发现${type}·${name}`);
      } else if (line.startsWith("CI|")) {
        const parts = line.split("|").map((s) => s.trim());
        const op = parts[1];
        const name = parts[2];
        if (!name || !op) continue;
        const key = `CI|${op}|${name}`;
        if (firedMarksRef.current.has(key)) continue;
        firedMarksRef.current.add(key);
        if (op === "获得") {
          fireDiscovery(`获得物品·${name}`);
          const ownKey = `${name}|${parts[4] || parts[3] || "主角"}`;
          newItemKeysRef.current = new Set(newItemKeysRef.current).add(ownKey);
          setNewItemKeys(new Set(newItemKeysRef.current));
          setTimeout(() => {
            newItemKeysRef.current = new Set([...newItemKeysRef.current].filter((k) => k !== ownKey));
            setNewItemKeys(new Set(newItemKeysRef.current));
          }, 2600);
          playItemChime();
        } else if (op === "转移") {
          fireDiscovery(`${name} → ${parts[3] || "?"}`);
        } else if (op === "损坏") {
          fireDiscovery(`${name} 损坏了`);
        } else if (op === "消耗" || op === "丢弃") {
          fireDiscovery(`失去物品·${name}`);
        } else if (op === "装备") {
          fireDiscovery(`装备·${name}`);
        }
      }
    }
  }, [fireDiscovery, playItemChime]);

  // ── SSE 通用消费（start / action 共用）：token 增量渲染 + 及时演算 + done 回调 ──
  const consumeSSE = useCallback(async (res: Response, onDone: (data: any) => void) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamedText = "";
    let done: any = null;
    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "token") {
            streamedText += event.content || "";
            setStreamed(hideStructBlocks(streamedText)); // 及时演算扫描用完整文本，显示用截断文本
            scanGameMarks(event.content || "");
          } else if (event.type === "roll") {
            setRollInfo({ d100: event.d100, label: event.label, successRate: event.successRate, reasons: event.reasons });
          } else if (event.type === "start_done" || event.type === "game_done") {
            done = event;
          } else if (event.type === "error") {
            throw new Error(event.content || event.error || "未知错误");
          }
        } catch (e: any) {
          if (e.message && !e.message.includes("JSON")) throw e;
        }
      }
    }
    if (!done) throw new Error("未收到结果");
    onDone(done);
  }, [scanGameMarks]);

  // ── 开始本章（开场叙事；saga 模式 start 会重置本章会话，从头开局）──
  const startChapter = async (chapter: SagaChapter) => {
    setActiveChapter(chapter);
    setStatus("generating");
    setNarrative("");
    setStreamed("");
    setOptions([]);
    setRollInfo(null);
    setEntities([]);
    setItems([]);
    setTurns([]);
    setRound(0);
    setTotalWords(0);
    setPlotProgress(0);
    markBufRef.current = "";
    firedMarksRef.current = new Set();
    const controller = new AbortController();
    streamRef.current = controller;
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sagaId, sagaChapterId: chapter.id }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(err.error || "开场失败");
      }
      await consumeSSE(res, (done) => {
        setSessionId(done.sessionId);
        setStatus("playing");
        setNarrative(done.narrative || "");
        setOptions(done.options || []);
        setStreamed("");
        setRound(done.currentRound || 1);
        setTotalWords(done.totalWords || 0);
        setPlotProgress(done.plotProgress || 0);
        setEntities(done.newEntities || []);
        setItems(done.items ?? []);
        setTurns([{ round: 1, playerAction: "开始本章", narrative: done.narrative || "" }]);
        load(); // 刷新章节列表（会话状态）
      });
    } catch (e: any) {
      if (e.name !== "AbortError") toastError(e.message || "开场失败");
      setStatus("idle");
    }
  };

  // ── 行动入口（两段式分流）：跑团+对抗 → 先掷骰（动画+可重骰），点「继续」才叙事 ──
  const pendingActionRef = useRef<{ actionType: string; actionText: string; selectedOption?: number } | null>(null);

  const act = async (actionType: string, actionText: string, selectedOption?: number) => {
    if (!sessionId || status !== "playing") return;
    // 上帝/GM 视角不掷骰：没有"我在冒险"，编排里的成败由 AI 按戏剧性演（也避免上帝给自己作弊）
    if (saga?.narrativeMode !== "god" && saga?.rollMode === "tabletop" && isConfrontationalAction(actionType, actionText)) {
      pendingActionRef.current = { actionType, actionText, selectedOption };
      setDice({ rolling: true, result: null });
      await doRoll(false);
      return;
    }
    await runAction(actionType, actionText, selectedOption, undefined);
  };

  // ── 掷骰（第一段）：/api/game/roll，动画 1.6s 后揭晓；isReroll 消耗次数 ──
  const doRoll = async (isReroll: boolean) => {
    const p = pendingActionRef.current;
    if (!p) return;
    try {
      const res = await fetch("/api/game/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sagaId, actionType: p.actionType, actionText: p.actionText, isReroll }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "掷骰失败");
      if (data.skipped) {
        // 非对抗/自由模式兜底：直接叙事
        setDice(null);
        await runAction(p.actionType, p.actionText, p.selectedOption, undefined);
        return;
      }
      // 悬浮动画 1.6 秒后揭晓（期间页面完全可操作）
      setTimeout(() => {
        setDice({ rolling: false, result: { d100: data.d100, label: data.label, successRate: data.successRate, reasons: data.reasons || [], rerollsLeft: data.rerollsLeft, rerollMax: data.rerollMax } });
      }, 1600);
    } catch (e: any) {
      toastError(e.message || "掷骰失败");
      setDice(null);
    }
  };

  // ── 重骰：消耗次数重掷 ──
  const reroll = async () => {
    setDice({ rolling: true, result: null });
    await doRoll(true);
  };

  // ── 继续（第二段）：带预掷结果生成叙事 ──
  const continueAfterRoll = async () => {
    const p = pendingActionRef.current;
    const d = dice?.result;
    if (!p || !d) return;
    pendingActionRef.current = null;
    setDice(null);
    await runAction(p.actionType, p.actionText, p.selectedOption, { d100: d.d100, successRate: d.successRate, reasons: d.reasons });
  };

  // ── 执行行动（第二段本体）──
  const runAction = async (
    actionType: string,
    actionText: string,
    selectedOption: number | undefined,
    preRolled: { d100: number; successRate: number; reasons?: string[] } | undefined
  ) => {
    if (!sessionId || status !== "playing") return;
    setStatus("generating");
    setStreamed("");
    setRollInfo(null);
    const controller = new AbortController();
    streamRef.current = controller;
    const prevItems = items;
    try {
      const res = await fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, actionType, actionText, selectedOption, preRolled }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(err.error || "行动失败");
      }
      await consumeSSE(res, (done) => {
        const newRound = round + 1;
        setStatus("playing");
        setNarrative((prev) => (prev ? `${prev}\n\n${done.narrative}` : done.narrative));
        setOptions(done.options || []);
        setStreamed("");
        setRound(newRound);
        setTotalWords((w) => w + (done.wordCount || 0));
        if (done.plotProgress) setPlotProgress(done.plotProgress);
        // 实体合并去重（与旧游戏模式同逻辑）
        setEntities((prev) => {
          const merged = [...prev];
          for (const ne of done.newEntities || []) {
            if (!merged.find((e) => e.name === ne.name)) merged.push(ne);
          }
          return merged;
        });
        // 背包增量更新（纯函数不可变，与引擎 applyItemChanges 同语义）
        const updated = applyFrontendItemChanges(prevItems as any, done.itemChanges || [], newRound) as unknown as GItem[];
        setItems(updated);
        flagNewItems(prevItems, updated);
        setTurns((prev) => [...prev, { round: newRound, playerAction: actionText, narrative: done.narrative || "" }]);
        load();
      });
    } catch (e: any) {
      if (e.name !== "AbortError") toastError(e.message || "行动失败");
      setStatus("playing");
    }
  };

  // ── 回退上一轮（后悔药）：删本轮 gameState 并回滚会话，用后端权威摘要整体覆盖 ──
  const rollbackLastRound = async () => {
    if (!sessionId || round <= 1 || status !== "playing") return;
    if (!confirm(`撤回第 ${round} 轮？该轮叙事、物品与实体变动将一并删除，回退后可换一个行动重来。`)) return;
    setStatus("generating");
    try {
      const res = await fetch(`/api/game/state?sessionId=${encodeURIComponent(sessionId)}&round=${round}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "回退失败");
      const sm = data.summary;
      setRound(sm.currentRound || 0);
      setTotalWords(sm.totalWords || 0);
      setPlotProgress(sm.plotProgress || 0);
      setItems((sm.items || []) as GItem[]);
      setEntities((sm.entities || []) as GEntity[]);
      setNarrative(sm.narrative || "");
      setOptions((sm.options || []) as GameOption[]);
      setTurns((prev) => prev.filter((t) => t.round <= (sm.currentRound || 0)));
      setStreamed("");
      toastSuccess(`已回退到第 ${sm.currentRound} 轮，换一个行动重来`);
      setStatus("playing");
    } catch (e: any) {
      toastError(e.message || "回退失败");
      setStatus("playing");
    }
  };

  // ── 正文编辑（P1）：逐轮直接修改游戏内叙事，PATCH 落库后用权威摘要覆盖 ──
  const [editingRound, setEditingRound] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // ── 角色交互（P1 自由操作）：点人/点热点 → 交互菜单（行动即模板，后果由 AI 演）──
  const [interactChar, setInteractChar] = useState<string | null>(null);
  // 角色卡 / 个人界面
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const sheetPromptedRef = useRef(false); // 首次进入只自动弹一次
  // 我的角色背包件数（左栏摘要）
  const myItemCount = useMemo(() => {
    const asName = saga?.playAsName || "主角";
    return items.filter((i) => (i.owner || asName) === asName).length;
  }, [items, saga?.playAsName]);
  const [showGive, setShowGive] = useState(false); // 赠予：展开主角物品选择
  const interactWith = (name: string, actionType: string, text: string) => {
    setInteractChar(null);
    setShowGive(false);
    void act(actionType, text);
  };
  const saveEdit = async () => {
    if (editingRound == null || !sessionId) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/game/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, round: editingRound, narrative: editDraft }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "保存失败");
      const sm = data.summary;
      setTotalWords(sm.totalWords || 0);
      setNarrative(sm.narrative || "");
      setItems((sm.items || []) as GItem[]);
      setEntities((sm.entities || []) as GEntity[]);
      setTurns((prev) => prev.map((t) => (t.round === editingRound ? { ...t, narrative: editDraft } : t)));
      setEditingRound(null);
      toastSuccess(`第 ${editingRound} 轮正文已更新`);
    } catch (e: any) {
      toastError(e.message || "保存失败");
    } finally {
      setSavingEdit(false);
    }
  };

  // ── 继续本章（退出后再进来不丢进度）：GET /api/game/state 拉权威摘要整体恢复 ──
  // 与「重开本章」（start 会重置会话）严格区分——这是敢退出的前提。
  const resumeChapter = async (chapter: SagaChapter) => {
    if (!chapter.sessionId) return;
    setActiveChapter(chapter);
    setStatus("generating");
    setStreamed("");
    try {
      const res = await fetch(`/api/game/state?sessionId=${encodeURIComponent(chapter.sessionId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok || !data.summary) throw new Error(data.error || "恢复进度失败");
      const sm = data.summary;
      setSessionId(chapter.sessionId);
      setRound(sm.currentRound || 0);
      setTotalWords(sm.totalWords || 0);
      setPlotProgress(sm.plotProgress || 0);
      setNarrative(sm.narrative || "");
      setItems((sm.items || []) as GItem[]);
      setEntities((sm.entities || []) as GEntity[]);
      setOptions((sm.options || []) as GameOption[]);
      setTurns((sm.turns || []).map((t: any) => ({ round: t.round, playerAction: t.playerAction, narrative: t.narrative || "" })));
      setStatus("playing");
    } catch (e: any) {
      toastError(e.message || "恢复进度失败");
      setStatus("idle");
    }
  };

  // ── 收束本章 → 自动建下一章 → 自动开始（连续扮演：一键无缝进入下一章）──
  const continueNextChapter = async () => {
    if (!sessionId || !activeChapter) return;
    setEndingChapter(true);
    setStatus("generating");
    try {
      const res = await fetch("/api/game/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "收束失败");
      // 自动建下一章（index 自动递增，前情提要由引擎自动注入开场）
      const cres = await fetch(`/api/game/saga/${sagaId}/chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const cdata = await cres.json();
      if (!cres.ok) throw new Error(cdata.error || "开新章失败");
      toastSuccess(`第 ${activeChapter.index} 章已收束，继续第 ${cdata.chapter.index} 章`);
      setActiveChapter(null);
      setSessionId(null);
      await load();
      // 无缝续玩
      await startChapter({ ...cdata.chapter, wordCount: 0, sessionRound: 0, sessionWords: 0, sessionId: null, sessionStatus: null });
    } catch (e: any) {
      toastError(e.message || "续章失败");
      setStatus("playing");
    } finally {
      setEndingChapter(false);
    }
  };

  // ── 结束本章：AI 自动写收尾（2-3 段，按当前视角口径）→ 归档本章（想停下来时用）──
  const endChapter = async () => {
    if (!sessionId) return;
    if (!confirm("结束本章？\n\nAI 会先为这一章自动写 2-3 段收尾（小说的自然落幕），然后把本章归档。\n归档后可在左侧章节列表回看正文，随时点「继续本章」或开新章。")) return;
    setEndingChapter(true);
    setStatus("generating");
    try {
      const res = await fetch("/api/game/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "收束失败");
      // 收尾段即时上屏：作为「本章收束」一条轮次留在正文里（同时已落库到章节 content）
      if (data.endingNarrative) {
        setTurns((prev) => [...prev, { round: (prev[prev.length - 1]?.round ?? round) + 1, playerAction: "本章收束", narrative: data.endingNarrative }]);
      }
      if (data.totalWords) setTotalWords(data.totalWords);
      setActiveChapter((prev) => (prev ? { ...prev, status: "archived", wordCount: data.totalWords || prev.wordCount } : prev));
      setSessionId(null);
      toastSuccess("AI 已为本章写好收尾，本章已归档");
      setStatus("idle");
      load();
    } catch (e: any) {
      toastError(e.message || "收束失败");
      setStatus("playing");
    } finally {
      setEndingChapter(false);
    }
  };

  // ── 新章 ──
  const createChapter = async () => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}/chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: chapterTitle.trim() || undefined, outline: chapterOutline.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "新建失败");
      toastSuccess("新章已建");
      setShowNewChapter(false);
      setChapterTitle("");
      setChapterOutline("");
      load();
    } catch (e: any) {
      toastError(e.message || "新建失败");
    }
  };

  const renameChapter = async (c: SagaChapter) => {
    const t = prompt("修改章节名", c.title);
    if (!t || !t.trim()) return;
    await fetch(`/api/game/saga/${sagaId}/chapter/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t.trim() }),
    });
    load();
  };

  // ── 扮演设置（P0-3）：选谁由你来演（局级设置，下一章生效）──
  const setPlayAs = async (name: string) => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name ? { playAsName: name, playAsCharacterId: saga?.playAsCandidates.find((c) => c.name === name)?.id ?? null } : { playAsName: null, playAsCharacterId: null }),
      });
      if (!res.ok) throw new Error("设置失败");
      toastSuccess(name ? `下一章起你将扮演「${name}」` : "已恢复默认主角视角");
      load();
    } catch (e: any) {
      toastError(e.message || "设置失败");
    }
  };

  // ── 叙事视点（三档）：第一人称亲历 / 第三人称小说镜头 / 群像上帝·GM ──
  const setNarrativeMode = async (mode: string) => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narrativeMode: mode }),
      });
      if (!res.ok) throw new Error("切换失败");
      const label = mode === "god" ? "上帝视角：你不再扮演任何人，输入即导演编排" : mode === "third" ? "第三人称小说视角：镜头跟随你的角色" : "第一人称：你就是你的角色";
      if (mode === "god") setLeftTab("plot"); // 暗线账本在「情节」页，切过去就能看见
      toastSuccess(label);
      load();
    } catch (e: any) {
      toastError(e.message || "切换失败");
    }
  };

  const deleteChapter = async (c: SagaChapter) => {
    if (!confirm(`删除第 ${c.index} 章「${c.title}」？其全部轮次${c.status === "archived" ? "与正文" : ""}将一并删除。`)) return;
    await fetch(`/api/game/saga/${sagaId}/chapter/${c.id}`, { method: "DELETE" });
    if (activeChapter?.id === c.id) { setActiveChapter(null); setSessionId(null); setStatus("idle"); }
    load();
  };

  const itemCls = (i: GItem) =>
    newItemKeys.has(`${i.name}|${i.owner || "主角"}`) ? "item-detected relative" : "";

  // 语义热点候选（P1 万物可交互）：场景实体 + 背包物品 + 角色卡名兜底（详情 API 全量返回，含待审）。
  // 实测 LLM 偶尔漏打 NE| 标记——角色卡名兜底保证正文里的人名必然可点。
  const hotspotNames = [
    ...entities.map((e) => e.name),
    ...items.map((i) => i.name),
    ...(saga?.hotspotNames || []),
  ];

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-sm text-[var(--nv-text-secondary)]">游戏本不存在或已删除</p>
        <Button onClick={() => router.push("/gamesaga")} className="btn-ghost mt-4 rounded-xl px-4 py-2 text-sm">返回游戏本</Button>
      </div>
    );
  }
  if (!saga) {
    return <div className="flex justify-center py-20"><LoadingDots label="加载游戏本" /></div>;
  }

  const charEntities = entities.filter((e) => e.type === "角色" || (e.type || "").includes("角色"));
  const factionEntities = entities.filter((e) => e.type === "势力" || (e.type || "").includes("势力"));
  const activeChapterOutline = activeChapter?.outline || null;

  return (
    <div
      data-game-theme="night"
      className="game-root relative flex h-screen flex-col overflow-hidden bg-[var(--nv-void)] text-[var(--nv-text-secondary)] font-sans"
    >
      {/* 星空粒子背景（吸收旧游戏模式的沉浸氛围） */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <GameParticles ref={particlesRef} theme="night" />
      </div>

      {/* 检测发现提示层（及时演算：标记一出现立即上屏） */}
      {discoveries.length > 0 && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          {discoveries.map((d) => (
            <div
              key={d.id}
              className="nf-discovery-pill flex items-center gap-1.5 rounded-full border bg-[var(--nv-surface-1)]/90 px-3 py-1 text-xs font-medium shadow-lg backdrop-blur-sm"
              style={{ borderColor: "#E4B863", color: "#E4B863" }}
            >
              <Icon name="sparkles" size={12} />
              {d.label}
            </div>
          ))}
        </div>
      )}

      {/* 顶部：暗色玻璃 */}
      <div className="relative z-10 mb-3 flex items-center justify-between gap-3 border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/60 px-4 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          {/* 退出游戏：用户反馈「进去退不出去」——从 16px 图标改为带文字的明显按钮 */}
          <button
            onClick={() => router.push("/gamesaga")}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2.5 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
            title="退出游戏模式，返回游戏本列表（进度已保存）"
          >
            <Icon name="arrowLeft" size={13} /> 退出
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-[var(--nv-text-primary)]">{saga.title}</h1>
            <p className="text-xs text-[var(--nv-text-tertiary)]">
              {saga.sourceBookName ? `前传：《${saga.sourceBookName}》 · ` : ""}{saga.chapters.length} 章
              {saga.narrativeMode === "god"
                ? " · 上帝视角（不扮演任何人）"
                : saga.playAsName
                  ? ` · ${saga.narrativeMode === "third" ? "跟随" : "扮演"} ${saga.playAsName}`
                  : ""}
              {activeChapter ? ` · 第 ${round} 轮 · ${totalWords} 字` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {/* 玩法教程（本页直达） */}
          <Button onClick={() => setShowTutorial(true)} className="btn-ghost h-8 rounded-lg px-3 text-xs" title="怎么玩：模式区别 / 背包世界 / 发现提示">
            <Icon name="lightbulb" size={12} /> 玩法
          </Button>
          {/* 叙事视点（三档）：亲历 / 小说 / 上帝——分段控件比下拉更直观 */}
          <div
            className="flex h-8 items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-0.5"
            title="亲历=你就是角色（第二人称「你」）；小说=第三人称镜头跟随你的角色；上帝=不扮演任何人，输入即导演编排，暗线真相对你公开"
          >
            {([
              { v: "first", label: "亲历", icon: "user" },
              { v: "third", label: "小说", icon: "book" },
              { v: "god", label: "上帝", icon: "eye" },
            ] as const).map((m) => {
              const on = (saga.narrativeMode || "first") === m.v;
              return (
                <button
                  key={m.v}
                  onClick={() => { if (!on) setNarrativeMode(m.v); }}
                  className={`flex h-full items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
                    on
                      ? m.v === "god"
                        ? "bg-[var(--nv-primary)]/15 font-medium text-[var(--nv-primary)]"
                        : "bg-[var(--nv-creative-soft)] font-medium text-[var(--nv-creative)]"
                      : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                  }`}
                >
                  <Icon name={m.icon as IconName} size={11} /> {m.label}
                </button>
              );
            })}
          </div>
          {/* 交互模式开关（P0-4）：自由叙事 / 跑团检定 */}
          <select
            value={saga.rollMode || "free"}
            onChange={async (e) => {
              const mode = e.target.value;
              try {
                const res = await fetch(`/api/game/saga/${sagaId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rollMode: mode }),
                });
                if (!res.ok) throw new Error();
                toastSuccess(mode === "tabletop" ? "跑团检定已开启：对抗行动将掷骰定结果" : "已切换为自由叙事模式");
                load();
              } catch {
                toastError("切换失败");
              }
            }}
            title="自由叙事=AI 裁决一切；跑团检定=对抗行动掷骰定结果，AI 只演不判"
            className="h-8 cursor-pointer rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none transition-colors hover:border-[var(--nv-creative-soft)] focus:border-[var(--nv-creative-soft)]"
          >
            <option value="free">模式：自由叙事（无骰子）</option>
            <option value="tabletop">模式：跑团检定（对抗掷骰）</option>
          </select>
          {/* 重骰难度档：简单=无限重骰 / 困难=3 次 / 真实=不可重骰 */}
          {saga.rollMode === "tabletop" && (
            <select
              value={saga.rollDifficulty || "hard"}
              onChange={async (e) => {
                try {
                  const res = await fetch(`/api/game/saga/${sagaId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rollDifficulty: e.target.value }),
                  });
                  if (!res.ok) throw new Error();
                  const label = e.target.value === "easy" ? "简单（无限重骰）" : e.target.value === "real" ? "真实（不可重骰）" : "困难（3 次重骰）";
                  toastSuccess(`难度已调为${label}`);
                  load();
                } catch {
                  toastError("切换失败");
                }
              }}
              title="简单=无限重骰；困难=每章 3 次重骰；真实=骰出什么是什么，不能重骰"
              className="h-8 cursor-pointer rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none transition-colors hover:border-[var(--nv-creative-soft)] focus:border-[var(--nv-creative-soft)]"
            >
              <option value="easy">难度：简单</option>
              <option value="hard">难度：困难</option>
              <option value="real">难度：真实</option>
            </select>
          )}
          {/* 扮演选择（P0-3）：上帝视角不扮演任何人，隐藏 */}
          {saga.narrativeMode !== "god" && saga.playAsCandidates.length > 0 && (
            <select
              value={saga.playAsName || ""}
              onChange={(e) => setPlayAs(e.target.value)}
              title="选择你扮演的角色（局级设置，下一章生效）"
              className="h-8 cursor-pointer rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none transition-colors hover:border-[var(--nv-creative-soft)] focus:border-[var(--nv-creative-soft)]"
            >
              <option value="">扮演：默认主角</option>
              {saga.playAsCandidates.map((c) => (
                <option key={c.name} value={c.name}>扮演：{c.name}{c.role ? `（${c.role}）` : ""}</option>
              ))}
            </select>
          )}
          <Button onClick={() => setShowNewChapter((v) => !v)} className="btn-ghost h-8 shrink-0 rounded-lg px-3 text-xs">
            <Icon name="plus" size={12} /> 新章
          </Button>
        </div>
      </div>

      {showNewChapter && (
        <div className="relative z-10 mx-4 mb-3 space-y-2 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 p-4">
          <input value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} placeholder="章节名（留空自动「第N章」）" className="input-glass w-full rounded-lg px-3 py-2 text-sm" />
          <textarea value={chapterOutline} onChange={(e) => setChapterOutline(e.target.value)} placeholder="本章章纲（可选：想让这一章发生什么）" rows={3} className="input-glass w-full rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button onClick={createChapter} className="btn-primary rounded-lg px-4 py-1.5 text-xs">建章</Button>
            <Button onClick={() => setShowNewChapter(false)} className="btn-ghost rounded-lg px-4 py-1.5 text-xs">取消</Button>
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-h-0 flex-1 gap-3 px-4 pb-4">
        {/* 左栏：章节 + 情节/角色/势力 */}
        <aside className="hidden w-60 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/50 backdrop-blur-sm lg:flex">
          <div className="shrink-0 space-y-1 overflow-y-auto border-b border-[var(--nv-border-2)] p-2" style={{ maxHeight: "34%" }}>
            {saga.chapters.map((c) => (
              <div
                key={c.id}
                className={`group rounded-xl border px-3 py-2 transition-colors ${
                  activeChapter?.id === c.id
                    ? "border-[var(--nv-creative-soft)] bg-[var(--nv-creative-soft)]"
                    : c.status === "archived"
                      ? "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/30 opacity-70"
                      : "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-xs font-medium text-[var(--nv-text-primary)]">
                    {c.index}. {c.title}{c.status === "archived" ? " · 已收束" : ""}
                  </p>
                  <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => renameChapter(c)} title="改名" className="text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)]"><Icon name="pencil" size={10} /></button>
                    <button onClick={() => deleteChapter(c)} title="删除" className="text-[var(--nv-text-muted)] hover:text-[var(--nv-danger)]"><Icon name="trash" size={10} /></button>
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-[var(--nv-text-tertiary)]">
                  {c.status === "archived" ? `${c.wordCount} 字` : c.sessionRound > 0 ? `第 ${c.sessionRound} 轮 · ${c.sessionWords} 字` : "未开始"}
                </p>
                {c.status !== "archived" && activeChapter?.id !== c.id && (
                  <>
                    <Button
                      onClick={() => (c.sessionId && c.sessionRound > 0 ? resumeChapter(c) : startChapter(c))}
                      disabled={status === "generating"}
                      className={`mt-1.5 h-6 w-full rounded-md px-2 text-[10px] ${c.sessionId && c.sessionRound > 0 ? "btn-primary" : "btn-ghost"}`}
                    >
                      {c.sessionId && c.sessionRound > 0 ? "继续本章" : "开始本章"}
                    </Button>
                    {c.sessionId && c.sessionRound > 0 && (
                      <button
                        onClick={() => { if (confirm(`重开第 ${c.index} 章？本章已有 ${c.sessionRound} 轮进度将被清空（建议先「继续本章」）`)) startChapter(c); }}
                        disabled={status === "generating"}
                        className="mt-1 w-full text-[9px] text-[var(--nv-text-muted)] transition-colors hover:text-[var(--nv-danger)]"
                        title="清空本章进度，从开场重新开始（不可撤回）"
                      >
                        重开本章
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex shrink-0 border-b border-[var(--nv-border-2)]">
            {LEFT_TABS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setLeftTab(key)}
                className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
                  leftTab === key
                    ? "border-b-2 border-[var(--nv-creative)] bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]"
                    : "border-b-2 border-transparent text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                }`}
              >
                <Icon name={icon} size={12} /> {label}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {leftTab === "plot" && (
              <div>
                {/* 上帝/GM：暗线账本（全知特权的可视证据）——放在默认的情节页，进来就能看见 */}
                {saga.narrativeMode === "god" && (
                  <div className="mb-3 rounded-xl border border-[var(--nv-creative)]/25 bg-[var(--nv-creative-soft)]/40 p-2">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                      <Icon name="eye" size={12} className="text-[var(--nv-creative)]" /> 暗线账本
                      <span className="rounded-full bg-[var(--nv-creative-soft)] px-1.5 text-[9px] text-[var(--nv-creative)]">上帝可见</span>
                    </p>
                    {saga.secretLedger.length === 0 && (
                      <p className="italic text-[var(--nv-text-muted)]">还没有埋设中的暗线——AI 藏起来的伪装与真相会记在这里</p>
                    )}
                    {saga.secretLedger.map((s, i) => (
                      <div key={`${s.name}-${i}`} className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/60 px-2 py-1.5">
                        <p className="text-[var(--nv-text-primary)]">{s.name}{s.owner ? ` · ${s.owner}` : ""}</p>
                        <p className="mt-0.5 text-[var(--nv-text-tertiary)]">真相：{s.truth}</p>
                        <p className="mt-0.5 text-[9px] text-[var(--nv-text-muted)]">第 {s.round} 轮埋设</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mb-2 font-medium text-[var(--nv-text-primary)]">情节进度</p>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
                  <div className="h-full rounded-full bg-[var(--nv-creative)] transition-all duration-700" style={{ width: `${plotProgress}%` }} />
                </div>
                <p className="text-right text-[var(--nv-creative)]">{plotProgress}%</p>
                {turns.length === 0 && <p className="mt-4 italic text-[var(--nv-text-muted)]">开始本章后，你的每个行动都会记录在这里</p>}
                {turns.map((t) => (
                  <button
                    key={t.round}
                    onClick={() => document.getElementById(`turn-${t.round}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    title="点击跳到这一轮的正文"
                    className="mt-2 block w-full rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5 text-left transition-colors hover:border-[var(--nv-creative-soft)]"
                  >
                    <p className="text-[var(--nv-creative)]">第{t.round}轮</p>
                    <p className="mt-0.5 line-clamp-2 text-[var(--nv-text-tertiary)]">{t.playerAction}</p>
                  </button>
                ))}
              </div>
            )}
            {leftTab === "characters" && (
              <div>
                {/* 我的角色：个人界面入口；上帝视角不扮演任何人 → 不显示（暗线账本在「情节」页） */}
                {saga.narrativeMode !== "god" && (
                  <>
                    <p className="mb-2 font-medium text-[var(--nv-text-primary)]">我的角色</p>
                    <button
                      onClick={() => { setSheetName(saga.playAsName || null); setSheetOpen(true); }}
                      title="打开我的角色卡：个人状态 / 个人背包 / 能力 / 编辑"
                      className="block w-full rounded-xl border border-[var(--nv-primary)]/30 bg-[var(--nv-primary)]/[0.07] px-2.5 py-2 text-left transition-colors hover:border-[var(--nv-primary)]/60"
                    >
                      <p className="flex items-center gap-1.5 text-[var(--nv-text-primary)]">
                        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--nv-primary)]/15 text-[10px] font-bold text-[var(--nv-primary)]">
                          {(saga.playAsName || "主").slice(0, 1)}
                        </span>
                        <span className="truncate font-medium">{saga.playAsName || "主角"}</span>
                        <span className="ml-auto shrink-0 rounded-full bg-[var(--nv-surface-3)] px-1.5 text-[9px] text-[var(--nv-text-tertiary)]">
                          背包 {myItemCount}
                        </span>
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--nv-text-tertiary)]">点开个人界面 · 状态 / 背包 / 能力 / 编辑</p>
                    </button>
                  </>
                )}

                <p className="mb-2 mt-4 font-medium text-[var(--nv-text-primary)]">场景角色</p>
                {charEntities.length === 0 && <p className="italic text-[var(--nv-text-muted)]">剧情推进中遇到的角色会实时出现在这里</p>}
                {charEntities.map((e) => (
                  <div
                    key={e.name}
                    className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5 transition-colors hover:border-[var(--nv-creative-soft)]"
                  >
                    <button
                      onClick={() => { setSheetName(e.name); setSheetOpen(true); }}
                      title={`查看${e.name}的角色卡（状态/背包/能力，可编辑）`}
                      className="block w-full text-left"
                    >
                      <p className="flex items-center gap-1.5 text-[var(--nv-text-primary)]">
                        <Icon name="user" size={12} className="text-[var(--nv-text-tertiary)]" />
                        {e.name}
                        {e.name === saga.playAsName && saga.narrativeMode !== "god" && <span className="rounded bg-[var(--nv-primary)]/12 px-1 text-[9px] text-[var(--nv-primary)]">你</span>}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[var(--nv-text-muted)]">{e.description}</p>
                    </button>
                    <div className="mt-1 flex justify-end">
                      <button
                        onClick={() => setInteractChar(e.name)}
                        className="rounded-md border border-[var(--nv-border-2)] px-1.5 py-0.5 text-[9px] text-[var(--nv-text-tertiary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-creative)]"
                        title={`与${e.name}交互（观察/对话/交易/赠予/偷窃/抢夺）`}
                      >
                        交互
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {leftTab === "factions" && (
              <div>
                <p className="mb-2 font-medium text-[var(--nv-text-primary)]">涉及势力</p>
                {factionEntities.length === 0 && <p className="italic text-[var(--nv-text-muted)]">遇到的门派/组织/势力会实时出现在这里</p>}
                {factionEntities.map((e) => (
                  <div key={e.name} className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5">
                    <p className="flex items-center gap-1.5 text-[var(--nv-text-primary)]">
                      <Icon name="building" size={12} className="text-[var(--nv-text-tertiary)]" />
                      {e.name}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* 中栏：游戏循环（暗色沉浸） */}
        <main className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/50 p-5 backdrop-blur-sm">
          {!activeChapter ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="nv-glow-strong flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--nv-creative)]/15">
                <Icon name="gamepad" size={44} className="text-[var(--nv-creative)]" />
              </div>
              <div>
                <p className="text-xl font-bold text-[var(--nv-text-primary)]">游戏本已就绪</p>
                <p className="mt-1.5 text-sm text-[var(--nv-text-secondary)]">从左侧选一章，化身角色亲历这段剧情</p>
              </div>
              <p className="max-w-sm text-xs leading-5 text-[var(--nv-text-tertiary)]">
                一章一局 · 收束后正文归档 · 新章自动继承前情{saga.rollMode === "tabletop" ? " · 跑团检定已开启" : ""}
                <br />
                游玩中获得的物品进入背包，遇到的角色/势力自动记录，发现即时上屏
              </p>
              {!saga.chapters.some((c) => c.status !== "archived") && (
                <Button onClick={() => setShowNewChapter(true)} className="btn-primary rounded-xl px-6 py-2 text-sm">
                  <Icon name="plus" size={14} /> 开启新章
                </Button>
              )}
              <button
                onClick={() => router.push("/gamesaga")}
                className="text-xs text-[var(--nv-text-tertiary)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--nv-text-primary)]"
              >
                退出游戏模式，返回游戏本列表
              </button>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--nv-text-primary)]">
                    第 {activeChapter.index} 章 · {activeChapter.title}
                  </p>
                  {status === "idle" && activeChapter.status === "archived" && (
                    <span className="shrink-0 rounded-full bg-[var(--nv-surface-3)] px-2 py-0.5 text-[10px] text-[var(--nv-text-tertiary)]">已归档 · 正文含 AI 收尾</span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {rollInfo && (
                    <span
                      className="max-w-[46%] truncate rounded-lg border border-[var(--nv-creative-soft)] bg-[var(--nv-creative-soft)] px-2.5 py-1 text-xs text-[var(--nv-text-primary)]"
                      title={`检定：d100=${rollInfo.d100}，成功率=${rollInfo.successRate ?? "?"}%（${(rollInfo.reasons || []).join("；")}）——结果既定，AI 只演不判`}
                    >
                      🎲 d100={rollInfo.d100} / 成功率{rollInfo.successRate ?? "?"}% · {rollInfo.label}
                    </span>
                  )}
                  {(status === "playing" || endingChapter) && (
                    <>
                      <Button
                        onClick={rollbackLastRound}
                        disabled={round <= 1 || endingChapter}
                        className="btn-ghost h-7 rounded-lg px-3 text-xs"
                        title="撤回本轮：删除该轮叙事与物品变动，换一个行动重来（第 1 轮不可回退）"
                      >
                        回退一轮
                      </Button>
                      <Button
                        onClick={endChapter}
                        disabled={endingChapter}
                        className="flex h-7 items-center gap-1 rounded-lg border border-[var(--nv-creative)]/40 bg-[var(--nv-creative-soft)] px-3 text-xs text-[var(--nv-creative)] transition-colors hover:border-[var(--nv-creative)] disabled:cursor-wait disabled:opacity-70"
                        title="结束本章：AI 自动为这一章写 2-3 段收尾，然后归档（不丢正文）"
                      >
                        <Icon name={endingChapter ? "loader" : "pencil"} size={11} />
                        {endingChapter ? "正在写收尾…" : "结束本章"}
                      </Button>
                      <Button onClick={continueNextChapter} disabled={endingChapter} className="btn-primary h-7 rounded-lg px-3 text-xs" title="收束本章（自动写收尾）并无缝开启下一章（前情自动继承）">
                        继续下一章 <Icon name="arrowRight" size={12} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {status === "idle" && activeChapter.status === "archived" && (
                <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 px-3 py-1.5 text-[11px] text-[var(--nv-text-tertiary)]">
                  <Icon name="check" size={12} className="text-[var(--nv-creative)]" />
                  本章已结束并归档（收尾已写入正文）。点左侧另一章继续，或右上「新章」开启下一章。
                </div>
              )}
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {streamed ? (
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nv-text-secondary)]">{streamed}</p>
                ) : turns.length > 0 ? (
                  <div className="space-y-5">
                    {turns.map((t) => (
                      <div key={t.round} id={`turn-${t.round}`} className="group/turn relative scroll-mt-4">
                        {editingRound === t.round ? (
                          <div className="space-y-2">
                            <p className="text-[10px] text-[var(--nv-text-tertiary)]">编辑第 {t.round} 轮叙事（直接修改游戏内正文，字数同步重算）</p>
                            <textarea
                              autoFocus
                              value={editDraft}
                              onChange={(e) => setEditDraft(e.target.value)}
                              rows={Math.min(18, Math.max(4, Math.ceil(editDraft.length / 42)))}
                              className="input-glass w-full rounded-lg px-3 py-2 text-sm leading-7"
                            />
                            <div className="flex justify-end gap-2">
                              <Button onClick={() => setEditingRound(null)} className="btn-ghost rounded-lg px-3 py-1.5 text-xs">取消</Button>
                              <Button onClick={saveEdit} disabled={savingEdit || !editDraft.trim()} className="btn-primary rounded-lg px-3 py-1.5 text-xs">
                                {savingEdit ? "保存中…" : "保存"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nv-text-secondary)]">
                              {renderHotspots(t.narrative, hotspotNames, (n) => setInteractChar(n))}
                            </p>
                            <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover/turn:opacity-100">
                              <span className="text-[10px] text-[var(--nv-text-muted)]">第 {t.round} 轮 · {t.playerAction}</span>
                              <button
                                onClick={() => { setEditingRound(t.round); setEditDraft(t.narrative); }}
                                className="text-[10px] text-[var(--nv-text-muted)] transition-colors hover:text-[var(--nv-text-primary)]"
                                title="编辑本轮叙事（直接修改游戏内正文）"
                              >
                                <Icon name="pencil" size={10} /> 编辑本轮
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : narrative ? (
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nv-text-secondary)]">{narrative}</p>
                ) : status === "generating" ? (
                  <LoadingDots label="剧情引擎启动中" />
                ) : null}
              </div>

              {/* 选项 + 快捷动作 + 输入区 */}
              {status === "playing" && (
                <div className="mt-3 shrink-0 space-y-2">
                  {options.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {options.map((opt) => (
                        <button
                          key={opt.index}
                          onClick={() => act("option", `选择：${opt.text}`, opt.index)}
                          className="rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-3 py-2 text-left text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                        >
                          <span className="mr-1.5 font-mono text-[var(--nv-creative)]">{opt.index}.</span>
                          {opt.text}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* 快捷条：上帝视角=导演编排（点击填入半成品，补完再发），其余=角色行动（点了即发） */}
                  <div className="flex gap-1.5">
                    {saga.narrativeMode === "god"
                      ? GM_ACTIONS.map((action) => (
                          <button
                            key={action.label}
                            onClick={() => setCustomInput(action.fill)}
                            disabled={status !== "playing"}
                            title={action.desc}
                            className="group flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] py-1.5 text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Icon name={action.icon as IconName} size={14} />
                            <span className="text-[10px]">{action.label}</span>
                          </button>
                        ))
                      : QUICK_ACTIONS.map((action) => (
                          <button
                            key={action.type}
                            onClick={() => act(action.type, action.label)}
                            disabled={status !== "playing"}
                            title={action.desc}
                            className="group flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] py-1.5 text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Icon name={action.icon as IconName} size={14} />
                            <span className="text-[10px]">{action.label}</span>
                          </button>
                        ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && customInput.trim()) { act("custom", customInput.trim()); setCustomInput(""); } }}
                      placeholder={
                        saga.narrativeMode === "god"
                          ? "写下你的编排：安排谁做什么、发生什么、镜头切到哪…"
                          : saga.narrativeMode === "third"
                            ? `替「${saga.playAsName || "你的角色"}」决定下一步…`
                            : "描述你的行动…"
                      }
                      className="input-glass flex-1 rounded-lg px-3 py-2 text-sm"
                    />
                    <Button
                      onClick={() => { if (customInput.trim()) { act("custom", customInput.trim()); setCustomInput(""); } }}
                      disabled={!customInput.trim()}
                      className="btn-primary rounded-lg px-4 py-2 text-sm"
                    >
                      发送
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* 右栏：正文 / 背包 / 世界 */}
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/50 backdrop-blur-sm xl:flex">
          <div className="flex shrink-0 border-b border-[var(--nv-border-2)]">
            {RIGHT_TABS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={`flex flex-1 items-center justify-center gap-1 py-2 text-xs font-medium transition-colors ${
                  rightTab === key
                    ? "border-b-2 border-[var(--nv-creative)] bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]"
                    : "border-b-2 border-transparent text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                }`}
              >
                <Icon name={icon} size={12} /> {label}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-3 text-xs">
            {rightTab === "text" && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                    <Icon name="file" size={13} className="text-[var(--nv-creative)]" /> 正文进度
                  </p>
                  {narrative && (
                    <button
                      onClick={() => { navigator.clipboard.writeText(narrative).then(() => toastSuccess("本章正文已复制到剪贴板")).catch(() => toastError("复制失败")); }}
                      className="rounded-md border border-[var(--nv-border-2)] px-1.5 py-0.5 text-[10px] text-[var(--nv-text-muted)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                      title="复制本章累积的全部叙事正文"
                    >
                      复制全文
                    </button>
                  )}
                </div>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
                  <div className="h-full rounded-full bg-[var(--nv-creative)] transition-all duration-700" style={{ width: `${Math.min(100, (totalWords / 3000) * 100)}%` }} />
                </div>
                <p className="text-right text-[var(--nv-text-tertiary)]">本轮累计：{totalWords} 字 · 第 {round} 轮</p>
                <div className="mt-3 whitespace-pre-wrap leading-relaxed text-[var(--nv-text-secondary)] opacity-80">
                  {narrative || "正文将在游戏互动过程中实时生成…"}
                </div>
              </div>
            )}
            {rightTab === "backpack" && (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                    <Icon name="backpack" size={13} className="text-[var(--nv-creative)]" /> 当前背包
                  </p>
                  {/* 三档：全部 / 主角物品 / 同伴背包（按归属者分节） */}
                  <div className="flex items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-0.5">
                    {([
                      { k: "all", label: "全部" },
                      { k: "mine", label: "主角" },
                      { k: "companions", label: "同伴" },
                    ] as const).map(({ k, label }) => (
                      <button
                        key={k}
                        onClick={() => setBackpackFilter(k)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                          backpackFilter === k
                            ? "bg-[var(--nv-creative)] text-[var(--nv-text-primary)]"
                            : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const visibleItems =
                    backpackFilter === "mine"
                      ? items.filter((i) => !i.owner || i.owner === "主角")
                      : backpackFilter === "companions"
                        ? items.filter((i) => i.owner && i.owner !== "主角")
                        : items;
                  const useItem = (i: GItem, verb: "使用" | "装备") =>
                    act("use_item", `${verb}：${i.name}`);
                  const renderGroups = (list: GItem[]) => {
                    const groups: Array<{ key: string; title: string; list: GItem[]; tone: string; action?: "使用" | "装备" }> = [
                      { key: "consumable", title: "消耗品", list: list.filter((i) => i.category === "consumable" || i.category === "other"), tone: "text-[var(--nv-creative)]", action: "使用" },
                      { key: "equipment", title: "装备", list: list.filter((i) => i.category === "equipment"), tone: "text-[var(--nv-success)]", action: "装备" },
                      { key: "quest", title: "任务道具", list: list.filter((i) => i.category === "quest"), tone: "text-[var(--nv-warning)]" },
                      { key: "currency", title: "货币", list: list.filter((i) => i.category === "currency"), tone: "text-accent-label" },
                    ];
                    return (
                      <div className="space-y-1">
                        {groups.map((g) => g.list.length === 0 ? null : (
                          <div key={g.key}>
                            <p className="mb-1 mt-2 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">【{g.title}】</p>
                            {g.list.map((i, idx) => (
                              <div key={idx} className={`group flex items-center justify-between gap-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1 ${itemCls(i)}`}>
                                <div className="min-w-0">
                                  <span className="text-[var(--nv-text-primary)]">{i.name}</span>
                                  {i.damaged && (
                                    <span className="ml-1.5 rounded bg-[var(--nv-warning)]/20 px-1 py-0.5 text-[9px] text-[var(--nv-warning)]" title="已损坏——可能影响使用，也可能藏着内情">损</span>
                                  )}
                                  <span className={`ml-2 ${g.tone}`}>×{i.quantity}</span>
                                  <p className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">
                                    {i.source}{i.owner && i.owner !== "主角" && backpackFilter === "all" ? ` · 归属：${i.owner}` : ""}
                                  </p>
                                </div>
                                {g.action && (
                                  <button
                                    onClick={() => useItem(i, g.action!)}
                                    disabled={status !== "playing"}
                                    title={`作为行动${g.action}「${i.name}」`}
                                    className="shrink-0 rounded-md border border-[var(--nv-border-2)] px-1.5 py-0.5 text-[10px] text-[var(--nv-text-muted)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {g.action === "装备" && i.equipped ? "已装备" : g.action}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    );
                  };
                  if (visibleItems.length === 0) {
                    return (
                      <p className="italic text-[var(--nv-text-muted)]">
                        {backpackFilter === "companions"
                          ? "其他角色还没有随身物品——交易、讨要或在剧情里让他们拿到东西"
                          : backpackFilter === "mine"
                            ? "你的背包空空如也，在冒险中获取物品吧"
                            : "目前没有角色持有物品，在冒险中获取吧"}
                      </p>
                    );
                  }
                  // 总账（全部）：按归属者分节——主角置顶，其余角色各成一节（那一节就是 TA 的背包）。
                  // 每个角色的背包随剧情生长：现在没有≠以后没有，剧情里一拿到自动出现一节。
                  if (backpackFilter === "all") {
                    const owners = [...new Set(visibleItems.map((i) => i.owner || "主角"))].sort((a, b) => (a === "主角" ? -1 : b === "主角" ? 1 : a.localeCompare(b)));
                    return (
                      <div className="space-y-3">
                        {owners.map((owner) => (
                          <div key={owner}>
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--nv-text-primary)]">
                              <Icon name={owner === "主角" ? "user" : "building"} size={11} className="text-[var(--nv-text-tertiary)]" />
                              {owner}{owner === "主角" ? "（你）" : ""}的随身物品
                              {owner !== "主角" && (
                                <button
                                  onClick={() => setInteractChar(owner)}
                                  className="ml-auto text-[10px] font-normal text-[var(--nv-creative)] transition-opacity hover:underline"
                                  title={`与${owner}交互`}
                                >
                                  交互
                                </button>
                              )}
                            </p>
                            {renderGroups(visibleItems.filter((i) => (i.owner || "主角") === owner))}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (backpackFilter === "companions") {
                    const owners = [...new Set(visibleItems.map((i) => i.owner || "主角"))];
                    return (
                      <div className="space-y-3">
                        {owners.map((owner) => (
                          <div key={owner}>
                            <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[var(--nv-text-primary)]">
                              <Icon name="user" size={11} className="text-[var(--nv-text-tertiary)]" />
                              {owner}的随身物品
                              <span className="text-[10px] font-normal text-[var(--nv-text-tertiary)]">({visibleItems.filter((i) => (i.owner || "主角") === owner).length})</span>
                            </p>
                            {renderGroups(visibleItems.filter((i) => (i.owner || "主角") === owner))}
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return renderGroups(visibleItems);
                })()}
              </div>
            )}
            {rightTab === "world" && (
              <div>
                <p className="mb-3 flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                  <Icon name="globe" size={13} className="text-[var(--nv-creative)]" /> 世界设定
                </p>
                {!saga.synopsis && saga.loreEntries.length === 0 && !activeChapterOutline ? (
                  <p className="italic text-[var(--nv-text-muted)]">这个世界还没有留下设定——在开场剧情里探索它吧</p>
                ) : (
                  <div className="space-y-3">
                    {saga.synopsis && (
                      <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-3">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                          <Icon name="book" size={11} /> 世界观
                        </p>
                        <p className="whitespace-pre-wrap leading-relaxed text-[var(--nv-text-secondary)]">{saga.synopsis}</p>
                      </div>
                    )}
                    {activeChapterOutline && (
                      <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-3">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                          <Icon name="clipboard" size={11} /> 本章章纲
                        </p>
                        <p className="whitespace-pre-wrap leading-relaxed text-[var(--nv-text-secondary)]">{activeChapterOutline}</p>
                      </div>
                    )}
                    {saga.loreEntries.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">世界书 ({saga.loreEntries.length})</p>
                        {saga.loreEntries.map((e, idx) => (
                          <div key={idx} className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-3 transition-colors hover:border-[var(--nv-creative-soft)]">
                            <p className="text-xs font-medium text-[var(--nv-text-primary)]">{e.title}</p>
                            <p className="mt-1.5 line-clamp-4 text-[11px] leading-relaxed text-[var(--nv-text-tertiary)]">{e.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── 骰子悬浮判定（两段式）：右下角小面板，动画期间页面完全可操作 ── */}
      {dice && (
        <div className="dice-panel-in fixed bottom-24 right-6 z-[90] w-64 rounded-2xl border border-[var(--nv-border-3)] bg-[var(--nv-abyss)]/95 shadow-2xl backdrop-blur-md">
          {dice.rolling ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="dice-tumbling text-4xl" aria-hidden>🎲</span>
              <p className="font-mono text-2xl text-[var(--nv-text-muted)]">{diceTick}</p>
              <p className="text-xs text-[var(--nv-text-tertiary)]">命运骰子滚动中……</p>
            </div>
          ) : dice.result ? (
            <div className="space-y-2">
              <div className="dice-reveal flex items-baseline justify-center gap-2">
                <span className={`font-mono text-3xl font-bold ${
                  dice.result.label === "失败" || dice.result.label === "大失败"
                    ? "text-[var(--nv-danger)]"
                    : dice.result.label === "勉强成功"
                      ? "text-[var(--nv-warning)]"
                      : "text-[var(--nv-success)]"
                }`}>
                  {dice.result.d100}
                </span>
                <span className="text-sm font-medium text-[var(--nv-text-primary)]">{dice.result.label}</span>
              </div>
              <p className="text-center text-xs text-[var(--nv-text-tertiary)]">
                成功率 {dice.result.successRate}%{dice.result.reasons.length > 0 ? ` · ${dice.result.reasons[0]}` : ""}
              </p>
              {dice.result.reasons.length > 1 && (
                <p className="text-center text-[10px] leading-4 text-[var(--nv-text-muted)]" title={dice.result.reasons.join("；")}>
                  {dice.result.reasons.slice(1, 3).join("；")}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                {dice.result.rerollMax !== 0 && (dice.result.rerollMax === -1 || dice.result.rerollsLeft > 0) ? (
                  <button
                    onClick={reroll}
                    className="rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                    title="不服就再掷一次"
                  >
                    重骰 {dice.result.rerollMax === -1 ? "∞" : `剩 ${dice.result.rerollsLeft}`}
                  </button>
                ) : (
                  <span className="text-[10px] text-[var(--nv-text-muted)]">真实模式 · 骰出什么是什么</span>
                )}
                <Button onClick={continueAfterRoll} className="btn-primary h-7 rounded-lg px-3 text-xs">
                  继续 <Icon name="arrowRight" size={11} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── 角色交互菜单（P1 自由操作）：查看随身物品（纯 UI）+ 一键行动模板，后果由 AI 演 ── */}
      {interactChar && (
        <Modal open onClose={() => { setInteractChar(null); setShowGive(false); }} bare panelClassName="max-w-sm" labelledBy="interact-title">
          <div className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]">
                <Icon name="user" size={16} />
              </span>
              <div className="min-w-0">
                <h2 id="interact-title" className="truncate text-base font-bold text-[var(--nv-text-primary)]">{interactChar}</h2>
                {(() => {
                  const ent = entities.find((e) => e.name === interactChar);
                  return ent?.description ? (
                    <p className="truncate text-[10px] text-[var(--nv-text-tertiary)]" title={ent.description}>{ent.description}</p>
                  ) : null;
                })()}
              </div>
              <button onClick={() => { setInteractChar(null); setShowGive(false); }} className="ml-auto text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)]" title="关闭">
                <Icon name="x" size={14} />
              </button>
            </div>

            {/* 随身物品（纯 UI 查看：背包总账里 TA 的那一节） */}
            {(() => {
              const theirs = items.filter((i) => (i.owner || "主角") === interactChar);
              return (
                <div className="mb-3 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">随身物品（{theirs.length}）</p>
                  {theirs.length === 0 ? (
                    <p className="text-[11px] italic text-[var(--nv-text-muted)]">看起来两手空空——但 TA 说什么你可要自己判断。</p>
                  ) : (
                    <div className="space-y-1">
                      {theirs.map((i, idx) => (
                        <p key={idx} className="text-[11px] text-[var(--nv-text-secondary)]">
                          · {i.name} ×{i.quantity}
                          {i.damaged && <span className="ml-1 rounded bg-[var(--nv-warning)]/20 px-1 text-[9px] text-[var(--nv-warning)]">损</span>}
                          {i.equipped && <span className="ml-1 rounded bg-[var(--nv-success)]/20 px-1 text-[9px] text-[var(--nv-success)]">装备中</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* 行动模板：点了就发，成败由 AI 裁决（跑团模式下偷窃/抢夺自动掷骰） */}
            <p className="mb-2 text-[10px] text-[var(--nv-text-tertiary)]">选择行动（后果由剧情裁决——跑团模式下对抗行动先掷骰）：</p>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { label: "观察", text: `仔细观察${interactChar}的神态与举动`, type: "observe" },
                { label: "对话", text: `与${interactChar}交谈`, type: "dialogue" },
                { label: "交易", text: `尝试与${interactChar}做一笔交易`, type: "custom" },
                { label: "讨要", text: `试着向${interactChar}讨要一件东西`, type: "custom" },
                { label: "偷窃", text: `趁${interactChar}不注意，偷偷摸走TA身上的一样东西`, type: "custom" },
                { label: "抢夺", text: `直接动手抢夺${interactChar}身上的物品`, type: "custom" },
              ] as const).map((a) => (
                <button
                  key={a.label}
                  onClick={() => interactWith(interactChar, a.type, a.text)}
                  disabled={status !== "playing"}
                  className="rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-2 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {a.label}
                </button>
              ))}
            </div>

            {/* 赠予：展开主角物品选择 */}
            <div className="mt-2">
              <button
                onClick={() => setShowGive((v) => !v)}
                disabled={status !== "playing"}
                className="w-full rounded-lg border border-dashed border-[var(--nv-border-3)] py-1.5 text-xs text-[var(--nv-text-muted)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {showGive ? "收起" : `送 ${interactChar} 一件东西`}
              </button>
              {showGive && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {items.filter((i) => (i.owner || "主角") === "主角").length === 0 && (
                    <p className="text-[11px] italic text-[var(--nv-text-muted)]">你的背包是空的，先拿到东西才能送。</p>
                  )}
                  {items.filter((i) => (i.owner || "主角") === "主角").map((i, idx) => (
                    <button
                      key={idx}
                      onClick={() => interactWith(interactChar, "custom", `把「${i.name}」赠予${interactChar}`)}
                      className="rounded-full border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2.5 py-1 text-[11px] text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                    >
                      {i.name} ×{i.quantity}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* ── 角色卡 / 个人界面（我的角色 + 同伴） ── */}
      <CharacterSheetPanel
        sagaId={sagaId}
        open={sheetOpen}
        initialName={sheetName}
        isPlayerView
        items={items.map((i) => ({ name: i.name, category: i.category, owner: i.owner, broken: i.damaged, effect: i.source }))}
        onClose={() => setSheetOpen(false)}
        onPlayAsChanged={() => { void load(); }}
        onUseItem={(itemName) => { setSheetOpen(false); void runAction("custom", `使用「${itemName}」`, undefined, undefined); }}
      />

      {/* ── 玩法教程（本页直达） ── */}
      {showTutorial && (
        <Modal open onClose={() => setShowTutorial(false)} bare panelClassName="max-w-lg" labelledBy="saga-tutorial-title">
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="gamepad" size={22} className="text-[var(--nv-creative)]" />
              <h2 id="saga-tutorial-title" className="text-lg font-bold text-[var(--nv-text-primary)]">游戏本 · 玩法指引</h2>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-[var(--nv-text-secondary)]">
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">基本玩法</p>
                <p className="text-xs">左侧选一章点「开始本章」→ 阅读叙事 → 点选项 / 快捷动作 / 自由输入行动 → 剧情实时推进，发现与物品变动即时上屏。</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">两种模式有什么区别</p>
                <p className="text-xs"><span className="text-[var(--nv-text-primary)]">自由叙事</span>：没有骰子，AI 裁决一切行动成败。</p>
                <p className="text-xs"><span className="text-[var(--nv-text-primary)]">跑团检定</span>：战斗/偷袭/说服等对抗行动先掷骰（d100 对比成功率），骰出什么是什么，AI 只负责把结果演成剧情。难度档决定重骰次数：简单无限 / 困难 3 次 / 真实不可重骰。</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">三种叙事视点（顶栏「视角」随时切换）</p>
                <p className="text-xs"><span className="text-[var(--nv-text-primary)]">第一人称·亲历</span>：你就是你的角色，正文用「你」写；你只知道 TA 能感知到的。</p>
                <p className="text-xs"><span className="text-[var(--nv-text-primary)]">第三人称·小说</span>：你替角色做决定，正文用名字/他/她写 TA，镜头跟着 TA 走，像读小说，悬念不提前揭。</p>
                <p className="text-xs"><span className="text-[var(--nv-text-primary)]">上帝·群像编排</span>：不扮演任何人。你的输入是导演编排（安排谁做什么、镜头切到哪、发生什么），AI 必须照演；快捷条变成「推进时间 / 切镜头 / 制造意外 / 旁人视角 / 多线并行」，左栏还会显示 AI 藏起来的暗线真相。</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">面板速览</p>
                <p className="text-xs">左栏：章节切换 + 情节进度 + 遇到的角色与势力；右栏：正文累计、背包（物品可一键「使用/装备」作为行动）、世界观与世界书。</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">连续游玩</p>
                <p className="text-xs">一章玩到想收尾时点「结束本章」：AI 会先自动写 2-3 段收尾（按当前视角口径），然后把本章归档，正文不丢。点「继续下一章」则连收尾带开新章一次做完，新章自动继承前情，不用退出重来。</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">「化身角色亲历剧情」一轮到底发生什么</p>
                <ol className="space-y-1 pl-4 text-xs list-decimal">
                  <li><span className="text-[var(--nv-text-primary)]">你出招</span>：点选项 / 快捷动作 / 角色交互（观察·对话·交易·讨要·偷窃·抢夺·赠予）/ 从角色卡用装备 / 或直接自由输入任何行动。</li>
                  <li><span className="text-[var(--nv-text-primary)]">判定</span>（仅跑团检定）：检定官先读你的能力与处境，给出成功率与理由 → d100 掷骰（右下角动画，不挡操作）→ 骰出什么是什么，成败再交给叙事。能力写在角色卡里就会成为加成依据。</li>
                  <li><span className="text-[var(--nv-text-primary)]">演出</span>：AI 用第二人称「你」写这一轮；遇到的每个角色都按自己的目的行动——可以合作、敷衍、撒谎，也可能趁你不备做点什么。</li>
                  <li><span className="text-[var(--nv-text-primary)]">实时演算</span>：途中发现的人/势力/物品即时上屏；拿到、失去、损坏、被转移的物品立即更新到对应角色的背包（不等轮末）。</li>
                  <li><span className="text-[var(--nv-text-primary)]">接续</span>：每轮 300-600 字结束后给 3-4 个抉择，也可以完全不理它们、输入自己的行动。这是大世界探索的节奏——抉择不必都是大事件，「继续修炼」「继续赶路」「再探一处」这类平缓推进同样成立；事件按章纲与因果自然到来。</li>
                </ol>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">角色卡与个人界面</p>
                <p className="text-xs">左栏「我的角色」点开是你的个人界面：状态（体力/精神/伤势/情绪/位置）、个人背包、能力（检定时加成）、关系与备注，可逐项编辑。点任意同伴也能看 TA 的角色卡；底部「以 TA 的身份继续」即可换人——世界与进度不变，只换视角。</p>
              </div>
            </div>
            <button onClick={() => setShowTutorial(false)} className="mt-5 w-full btn-primary rounded-xl py-2.5 text-sm font-medium">
              明白了
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function SagaDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingDots label="加载" /></div>}>
      <SagaDetailInner />
    </Suspense>
  );
}
