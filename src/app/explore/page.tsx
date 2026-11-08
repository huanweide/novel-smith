"use client";

import { useState, useRef, useEffect, useCallback, useId } from "react";
import Link from "next/link";
import { BuildConfigPanel } from "@/components/explore/BuildConfigPanel";
import { AdoptedContentPanel } from "@/components/explore/AdoptedContentPanel";
import { ChatPanel } from "@/components/explore/ChatPanel";
import { OutlinePanel } from "@/components/explore/OutlinePanel";
import { StepProgress } from "@/components/explore/StepProgress";
import { Icon } from "@/components/ui/icons";
import type {
  BuildConfig,
  ExploreStep,
  ExploreMessage,
  AdoptedItem,
  AdoptCard,
} from "@/core/explore/types";
import { DEFAULT_BUILD_CONFIG, EXPLORE_STEPS, STEP_LABELS, STEP_DESCRIPTIONS, STEP_LUCIDE, STEP_PROMPTS } from "@/core/explore/types";
import { toastError, toastCreated, toastSubtle } from "@/components/ui/toast";
import { Modal } from "@/components/ui/Modal";
import { describeStreamError, describeHttpError } from "@/lib/stream-error";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useHealth } from "@/hooks/use-health";

/**
 * 游戏本模式（?as=saga）的步骤说明微调：
 * 同一套 11 步前置创作流程，只把「写小说」的口径换成「第一视角扮演的舞台」。
 * 用户定的规矩：游戏模式前置 = 创作模式，不是一句话「简单开始」。
 */
const GAME_STEP_DESCRIPTIONS: Partial<Record<ExploreStep, string>> = {
  protagonist: "你将扮演谁？姓名、性别、年龄、外貌、性格、背景与当前处境。这是你的第一视角——玩家的眼睛和手，其他角色交给 AI 扮演。",
  golden_finger: "你（这个角色）有什么特殊能力/优势/依仗？规则与限制是什么？跑团检定时会按它裁定成功率的加成与降低。",
  core_conflict: "你要面对的核心矛盾是什么？谁在追你、挡你、算计你？不解决会怎样？这决定你每轮行动的压力来源。",
  power_system: "这个世界的力量/战斗体系如何分级？你处于哪一级？对抗时怎么判定强弱？跑团检定需要一个可比较的参照系。",
  plot_thread: "开局怎么开始？第一幕你正在做什么、遇到什么事——这会成为首章章纲。再给主线一个大致走向，免得玩着没方向。",
};
function stepDescription(step: ExploreStep, asGame: boolean): string {
  return (asGame && GAME_STEP_DESCRIPTIONS[step]) || STEP_DESCRIPTIONS[step];
}

export default function ExplorePage() {
  const [config, setConfig] = useState<BuildConfig>(DEFAULT_BUILD_CONFIG);
  const [currentStep, setCurrentStep] = useState<ExploreStep>("opening");
  const [messages, setMessages] = useState<ExploreMessage[]>([
    {
      role: "agent",
      content: `嗨，我是你的 AI 创作搭子！🖊️\n\n我们从一个轻松的问题开始：你想写一本什么样的书？\n\n直接说想法就行——每次回复我都会附 3 张候选卡，挑一个就能继续，聊出什么都能采纳。`,
    },
  ]);
  const [adopted, setAdopted] = useState<AdoptedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"chat" | "outline">("chat");
  const [creating, setCreating] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(true);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  // 探讨模式玩法教程（顶栏「教程」直达）
  const [showTutorial, setShowTutorial] = useState(false);
  // 产出目标：小说项目（默认） / 游戏本（?as=saga，同一套 11 步，产出第一视角扮演的舞台）
  const [asGame, setAsGame] = useState(false);
  useEffect(() => {
    try { setAsGame(new URLSearchParams(window.location.search).get("as") === "saga"); } catch { /* ignore */ }
  }, []);
  // 无障碍：窄屏模态抽屉的焦点陷阱（仅抽屉打开时激活，桌面常驻侧栏不受影响）
  const leftDrawerRef = useRef<HTMLElement>(null);
  const rightDrawerRef = useRef<HTMLElement>(null);
  const leftDrawerTitleId = useId();
  const rightDrawerTitleId = useId();
  useFocusTrap(leftDrawerRef, leftDrawerOpen, () => setLeftDrawerOpen(false));
  useFocusTrap(rightDrawerRef, rightDrawerOpen, () => setRightDrawerOpen(false));

  // ── 系统健康：AI 是否配置（决定探讨模式是否真的能对话） ──
  const health = useHealth();
  const aiConfigured = health?.llm.ok ?? null;
  const [adoptStatus, setAdoptStatus] = useState<Record<string, string>>({});
  const [generatingAll, setGeneratingAll] = useState(false);
  // AI 一键构筑：方向提示词弹窗 + 构筑结果预览（右侧待确认区）
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [buildPrompt, setBuildPrompt] = useState("");
  const [generatePreview, setGeneratePreview] = useState<AdoptedItem[]>([]);
  const [outlineText, setOutlineText] = useState("");
  const [enrichPrompt, setEnrichPrompt] = useState("");
  const [outlineResult, setOutlineResult] = useState<{
    characters: any[];
    loreEntries: any[];
    plotOutline: string;
  } | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineProgress, setOutlineProgress] = useState<{
    phase: string;
    current?: number;
    total?: number;
  } | null>(null);

  // ── localStorage 持久化 ──
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("explore_state");
      if (saved) {
        const state = JSON.parse(saved);
        if (state.messages?.length) setMessages(state.messages);
        if (state.adopted?.length) setAdopted(state.adopted);
        if (state.config) setConfig(state.config);
        if (state.createdProjectId)
          setCreatedProjectId(state.createdProjectId);
        // 旧版本存过 mode: "cards"（抽卡已融合进自由讨论），消毒为合法值
        if (state.mode === "chat" || state.mode === "outline") setMode(state.mode);
        if (state.currentStep) setCurrentStep(state.currentStep);
      }
    } catch {
      /* localStorage 损坏，忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 从首页带入的上下文：文体（genre）+ 灵感火花（inspiration，v3.1.61 新增） ──
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const g = params.get("genre");
      const insp = params.get("inspiration");
      if (g) {
        setConfig((prev) => (prev.genre === g ? prev : { ...prev, genre: g }));
      }
      if (g || insp) {
        setMessages((prev) => {
          if (prev.length === 1 && prev[0].role === "agent") {
            const lead = g ? `你选择了「${g}」文体` : "我们从一个轻松的方向开始构思";
            const head = insp ? `${lead}，并带上了一枚「灵感火花」——我们顺着它往下聊！` : `${lead}，我们从这个方向开始构思！`;
            let body = `${head}\n\n我们从「${STEP_LABELS.opening}」聊起——它决定整本书的方向。`;
            if (insp) {
              body += `\n\n你带来的灵感火花是：\n「${decodeURIComponent(insp)}」\n\n你可以直接补充设定，也可以让它自由生长。`;
            } else {
              body += `\n\n说说你想写什么类型的小说？有什么初步想法？每次回复我都会附 3 张候选卡，挑一个就能继续。`;
            }
            return [{ role: "agent", content: body }];
          }
          return prev;
        });
      }
    } catch {
      /* URL 解析失败，忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const payload = JSON.stringify({
          messages: messages.slice(-50),
          adopted,
          config,
          createdProjectId,
          mode,
          currentStep,
        });
        if (payload !== lastSavedRef.current) {
          lastSavedRef.current = payload;
          localStorage.setItem("explore_state", payload);
        }
      } catch {
        /* quota exceeded, ignore */
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [messages, adopted, config, createdProjectId, mode, currentStep]);

  // ── ref 防抖 guard ──
  const loadingRef = useRef(false);
  const creatingRef = useRef(false);
  const outlineLoadingRef = useRef(false);

  // ─── 发送消息 ──────────────────────────────────────

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const adoptedRef = useRef(adopted);
  adoptedRef.current = adopted;

  // ─── 步骤切换过渡（大字闪现 + 聊天流内分隔芯片） ──────────────
  const [stepFlash, setStepFlash] = useState<{ step: ExploreStep; seq: number } | null>(null);
  const stepFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashStep = useCallback((step: ExploreStep) => {
    setStepFlash({ step, seq: Date.now() });
    if (stepFlashTimer.current) clearTimeout(stepFlashTimer.current);
    stepFlashTimer.current = setTimeout(() => setStepFlash(null), 1750);
  }, []);

  const handleStepChange = useCallback((step: ExploreStep) => {
    setCurrentStep(step);
    flashStep(step);
    setMessages((prev) => [
      ...prev,
      {
        role: "agent",
        content: `说说你关于${STEP_LABELS[step]}的想法？直接聊就行，聊出好点子点卡片就能收下。`,
        stepIntro: step,
      },
    ]);
  }, [flashStep]);

  // 底层发送：apiText 发给 LLM，displayText 显示为用户气泡（handleSend 与重摇共用）
  const sendExplore = useCallback(
    async (apiText: string, displayText: string) => {
      if (!apiText.trim() || loadingRef.current) return;

      const userMsg: ExploreMessage = { role: "user", content: displayText };
      setMessages((prev) => [...prev, userMsg]);
      loadingRef.current = true;
      setLoading(true);

      try {
        const res = await fetch("/api/explore/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: apiText,
            history: messagesRef.current.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            config,
            adopted,
            currentStep,
            mode,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `响应失败 (${res.status})`);
        }

        const data = await res.json();
        // 新卡去重：与已采纳设定同标题+同内容的卡不再展示，避免"说过了又来一遍"的混乱
        const rawCards: AdoptCard[] | undefined = Array.isArray(data.cards) ? data.cards : undefined;
        const newCards = rawCards?.filter(
          (c) => !adoptedRef.current.some((a) => a.title === c.title && a.content === c.content),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            content: data.reply || "收到。继续？",
            cards: newCards && newCards.length > 0 ? newCards : undefined,
          },
        ]);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: `出错了：${err.message}。重试一下？` },
        ]);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    // 依赖 config/adopted/currentStep/mode，但不依赖 messages（用 ref 替代）
    [config, adopted, currentStep, mode],
  );

  const handleSend = useCallback(
    (text: string) => sendExplore(text, text),
    [sendExplore],
  );

  // 换一批候选卡（重 roll）：重发上一条用户消息，可带重摇提示
  const handleReroll = useCallback(
    (hint?: string) => {
      if (loadingRef.current) return;
      const lastUser = [...messagesRef.current].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      const apiText = hint
        ? `${lastUser.content}\n\n（重摇提示：${hint}。请重新给出 3 张方向明显不同的候选卡）`
        : `${lastUser.content}\n\n（请重新给出 3 张方向明显不同的候选卡，不要重复上一批）`;
      void sendExplore(apiText, hint ? `🔄 重摇：${hint}` : "🔄 换一批候选卡");
    },
    [sendExplore],
  );

  // 模式切换：切出时给一句提示，避免"点了没反应"的困惑
  const handleModeChange = useCallback(
    (m: "chat" | "outline") => {
      if (m === mode) return;
      setMode(m);
      toastSubtle(
        m === "outline"
          ? "已切换到大纲模式：粘贴整篇大纲，AI 自动抽取角色与设定"
          : "已切换到自由讨论：直接聊，AI 每次回复附 3 张候选卡",
      );
    },
    [mode],
  );

  // ─── 采纳卡片 ──────────────────────────────────────

  const handleAdoptCard = useCallback(
    async (card: AdoptCard) => {
      if (adopted.some((a) => a.title === card.title && a.content === card.content))
        return;

      const itemId = `adopt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setAdoptStatus((prev) => ({ ...prev, [card.id]: "writing" }));

      const item: AdoptedItem = {
        id: itemId,
        step: card.step,
        title: card.title,
        content: card.content,
        timestamp: Date.now(),
      };

      try {
        const res = await fetch("/api/explore/adopt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: createdProjectId,
            config,
            card: { title: card.title, content: card.content, step: card.step },
          }),
        });
        const data = await res.json();
        if (res.ok) {
          // 成功后才置 adopted + 写入已采纳列表 + 卡片标记已采纳
          setAdopted((prev) => [...prev, item]);
          setMessages((prev) =>
            prev.map((m) => ({
              ...m,
              cards: m.cards?.map((c) =>
                c.id === card.id ? { ...c, adopted: true } : c,
              ),
            })),
          );
          setAdoptStatus((prev) => ({
            ...prev,
            [card.id]: "adopted",
          }));
          if (data.projectId && !createdProjectId) {
            setCreatedProjectId(data.projectId);
          }
          // 采纳后推进：仅当本次是该步骤的【首条采纳】时自动跳下一步（带大字过渡提示），
          // 后续补采不打断节奏；最后一步采纳后落回自由讨论。
          const hadAdoptedInStep = adopted.some((a) => a.step === card.step);
          if (!hadAdoptedInStep) {
            const idx = EXPLORE_STEPS.indexOf(card.step);
            if (idx >= 0 && idx < EXPLORE_STEPS.length - 1) {
              handleStepChange(EXPLORE_STEPS[idx + 1]);
            }
          }
        } else {
          // 失败：保留卡片可重试，状态串结构化（"failed"），绝不提前置 adopted
          setAdoptStatus((prev) => ({ ...prev, [card.id]: "failed" }));
        }
      } catch {
        setAdoptStatus((prev) => ({ ...prev, [card.id]: "failed" }));
      }
    },
    [adopted, config, createdProjectId, handleStepChange],
  );

  // ─── 大纲模式 ──────────────────────────────────────

  const handleOutlineSubmit = useCallback(async () => {
    if (!outlineText.trim() || outlineLoadingRef.current) return;
    outlineLoadingRef.current = true;
    setOutlineLoading(true);
    setOutlineResult(null);
    setOutlineProgress({ phase: "starting" });

    try {
      const res = await fetch("/api/explore/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "outline",
          message: outlineText,
          enrichPrompt,
          config,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const failure = describeHttpError(res.status, errData);
        toastError(failure.description, failure.title);
        setOutlineProgress(null);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === "progress") setOutlineProgress(data);
              else if (eventType === "done") {
                setOutlineResult(data);
                setOutlineProgress(null);
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "agent",
                    content:
                      data.reply || "大纲已整理完成。请确认后写入项目。",
                  },
                ]);
              } else if (eventType === "error") {
                throw new Error(data.error || "处理失败");
              }
            } catch (parseErr: any) {
              if (parseErr.message && !parseErr.message.includes("JSON"))
                throw parseErr;
            }
          }
        }
      }
    } catch (err: any) {
      const failure = describeStreamError(err);
      if (failure) toastError(failure.description, failure.title);
      setOutlineProgress(null);
    } finally {
      outlineLoadingRef.current = false;
      setOutlineLoading(false);
    }
  }, [outlineText, enrichPrompt, config]);

  // ─── 确认写入项目 ──────────────────────────────────

  const handleOutlineConfirm = useCallback(async () => {
    if (!outlineResult || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);

    try {
      let pid = createdProjectId;

      if (!pid) {
        // 首次确认：建项目骨架 + 批量写入三卡（一次请求，不再逐条 HTTP）
        const res = await fetch("/api/explore/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, adopted, mode: "direct", outline: outlineResult, rawOutlineText: outlineText }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "创建失败");
        pid = data.projectId;
        setCreatedProjectId(pid);
      } else {
        // 已有项目：批量追加（求同存异 upsert，结构化直写，不再二次解析）
        const res = await fetch("/api/explore/adopt-batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid, ...outlineResult }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "写入失败");
      }

      // 追加到已采纳列表（右侧面板展示，便于核对写入了什么）
      const newItems: AdoptedItem[] = [];
      const ts = Date.now();
      (outlineResult.characters || []).forEach((c: any, i: number) => {
        newItems.push({
          id: `ol_char_${ts}_${i}`,
          step: c.role === "protagonist" ? ("protagonist" as ExploreStep) : ("free_talk" as ExploreStep),
          title: c.name,
          content: c.background || "",
          timestamp: ts,
        });
      });
      (outlineResult.loreEntries || []).forEach((l: any, i: number) => {
        newItems.push({
          id: `ol_lore_${ts}_${i}`,
          step: "worldview" as ExploreStep,
          title: l.title,
          content: l.content || "",
          timestamp: ts,
        });
      });
      setAdopted((prev) => [...prev, ...newItems]);

      // AI 构筑的「待确认」项已随 outlineResult 落库，清空待确认区
      setGeneratePreview([]);

      toastCreated(config.novelName || "小说项目", "项目");
    } catch (err: any) {
      toastError(err?.message || "写入失败");
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [outlineResult, config, createdProjectId, adopted, outlineText]);

  // ─── 一键AI构建 ────────────────────────────────────

  const handleGenerateAll = useCallback(async (direction?: string) => {
    if (generatingAll) return;
    setGeneratingAll(true);
    try {
      const res = await fetch("/api/explore/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate_all",
          config,
          adopted,
          buildPrompt: direction?.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.characters?.length || data.loreEntries?.length)) {
        // ① 回填 AI 补齐的配置字段（novelName/protagonistName/direction/powerSystem/goldenFinger/coreConflict）
        if (data.configPatch && typeof data.configPatch === "object") {
          const patch = data.configPatch as Record<string, unknown>;
          setConfig((prev) => ({ ...prev, ...patch } as BuildConfig));
        }
        // ② 把生成结果转为「待确认」项——右侧「已导入设定（待确认）」区可视化展示，确认后才真正落库
        const ts = Date.now();
        const preview: AdoptedItem[] = [];
        (data.characters || []).forEach((c: any, i: number) => {
          preview.push({
            id: `gen_char_${ts}_${i}`,
            step: c.role === "protagonist" ? ("protagonist" as ExploreStep) : ("free_talk" as ExploreStep),
            title: c.name || `角色${i + 1}`,
            content: c.background || JSON.stringify(c.personality || "") || "",
            timestamp: ts,
          });
        });
        (data.loreEntries || []).forEach((l: any, i: number) => {
          preview.push({
            id: `gen_lore_${ts}_${i}`,
            step: "worldview" as ExploreStep,
            title: l.title || `设定${i + 1}`,
            content: l.content || "",
            timestamp: ts,
          });
        });
        setGeneratePreview(preview);
        // ③ 切到 outline 模式完整预览 + 确认写入
        setOutlineResult({
          characters: data.characters || [],
          loreEntries: data.loreEntries || [],
          plotOutline: data.plotOutline || "",
        });
        setOutlineProgress(null);
        setMode("outline");
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            content: data.reply || `已按${direction?.trim() ? `「${direction.trim().slice(0, 30)}」方向` : "你的配置"}生成 ${preview.length} 项设定，请在右侧「待确认」核对，满意后点「确认写入项目」。`,
          },
        ]);
      } else {
        const failure = describeHttpError(res.status, data);
        toastError(failure.description, failure.title);
      }
    } catch (err: any) {
      const failure = describeStreamError(err);
      if (failure) toastError(failure.description, failure.title);
    } finally {
      setGeneratingAll(false);
    }
  }, [config, adopted, generatingAll]);

  // ─── 创建项目 ──────────────────────────────────────

  const handleCreateProject = useCallback(
    async (createMode: "direct" | "ai_refine") => {
      if (creatingRef.current) return;
      creatingRef.current = true;
      setCreating(true);
      try {
        // ── 游戏本：同一套探讨成果，产出物换成「第一视角自由叙事的舞台」──
        // 世界观测/势力/力量体系/地图 → 世界书词条；主角 → 角色卡（＝玩家的第一视角）；情节脉络 → 首章章纲
        if (asGame) {
          const pick = (steps: ExploreStep[]) => adopted.filter((a) => steps.includes(a.step));
          const join = (list: AdoptedItem[]) =>
            list.map((i) => `【${STEP_LABELS[i.step]}】${i.title}：${i.content}`).join("\n\n");
          const title = config.novelName.trim() || pick(["opening"])[0]?.title?.trim() || "未命名游戏本";
          const synopsis = join(pick(["opening", "worldview", "core_conflict"]));
          const protagonist = pick(["protagonist"])[0];
          const protagonistName =
            config.protagonistName.trim() ||
            (protagonist ? protagonist.title.split(/[·:：\-—\s]/)[0].trim() : "");
          const characters = protagonist
            ? [{ name: protagonistName || "主角", role: "主角", background: protagonist.content }]
            : [];
          const lore = pick(["factions", "power_system", "currency", "map", "golden_finger"])
            .map((a) => ({ title: a.title, content: a.content }));
          const outline = join(pick(["plot_thread"])) || join(pick(["opening"]));

          const res = await fetch("/api/game/saga", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "explore",
              title,
              synopsis,
              characters,
              lore,
              outline,
              playAsName: protagonistName || undefined,
              chapterTitle: "第一章",
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const failure = describeHttpError(res.status, data);
            toastError(failure.description, failure.title);
            return;
          }
          toastCreated(title, "游戏本");
          window.location.href = `/gamesaga/${data.saga.id}`;
          return;
        }

        const res = await fetch("/api/explore/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config, adopted, mode: createMode }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setCreatedProjectId(data.projectId);
          toastCreated(config.novelName || "小说项目", "项目");
        } else {
          const failure = describeHttpError(res.status, data);
          toastError(failure.description, failure.title);
        }
      } catch (err: any) {
        const failure = describeStreamError(err);
        if (failure) toastError(failure.description, failure.title);
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [config, adopted, asGame],
  );

  // ─── 深入探讨已采纳内容 ──────────────────────────────
  const handleDeepDive = useCallback(
    async (item: AdoptedItem) => {
      const prompt = `我想深入探讨这个已经采纳的设定：\n【${STEP_LABELS[item.step]}】${item.title}\n${item.content}\n\n请从以下角度帮我展开、打磨它，让它更扎实、更有戏剧张力：\n1. 这个设定的内在逻辑与潜在矛盾\n2. 它和当前世界观/其他已采纳设定的咬合点\n3. 能衍生出的具体情节钩子或冲突\n4. 如果打磨出值得采纳的新子设定，请在末尾用 <ADOPT title="...">...</ADOPT> 块输出。`;

      // 切回对话模式并定位到该步骤，让用户直接看到这次深挖
      setMode("chat");
      setCurrentStep(item.step);

      if (loadingRef.current) return;
      const userMsg: ExploreMessage = { role: "user", content: `深入探讨：${item.title}` };
      setMessages((prev) => [...prev, userMsg]);
      loadingRef.current = true;
      setLoading(true);

      try {
        const res = await fetch("/api/explore/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: prompt,
            history: messagesRef.current.map((m) => ({ role: m.role, content: m.content })),
            config,
            adopted,
            currentStep: item.step,
            mode: "chat",
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `响应失败 (${res.status})`);
        }
        const data = await res.json();
        // 新卡去重：与已采纳设定同标题+同内容的卡不再展示，避免"说过了又来一遍"的混乱
        const rawCards: AdoptCard[] | undefined = Array.isArray(data.cards) ? data.cards : undefined;
        const newCards = rawCards?.filter(
          (c) => !adoptedRef.current.some((a) => a.title === c.title && a.content === c.content),
        );
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            content: data.reply || "收到。继续？",
            cards: newCards && newCards.length > 0 ? newCards : undefined,
          },
        ]);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: `出错了：${err.message}。重试一下？` },
        ]);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [adopted, config],
  );

  // 点击引导条的示例提问：先切回对话模式，确保用户看得到这次发送（大纲模式下消息会发到后台却看不见）
  const handleGuideSend = useCallback((text: string) => {
    if (mode !== "chat") setMode("chat");
    handleSend(text);
  }, [mode, handleSend]);

  return (
    <div className="h-screen flex flex-col bg-[var(--nv-void)] text-[var(--nv-text-secondary)] animate-in fade-in overflow-hidden">
      {/* ── 步骤切换大字过渡（全屏居中闪现 1.75s） ── */}
      {stepFlash && (
        <div key={stepFlash.seq} className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="animate-[nf-step-flash_1.75s_ease-in-out_both] flex flex-col items-center gap-2.5 px-10 py-7 rounded-3xl bg-[var(--nv-abyss)]/85 border border-[var(--nv-creative)]/30 shadow-[0_0_70px_var(--nv-creative-soft)] backdrop-blur-md">
            <span className="w-12 h-12 rounded-2xl bg-[var(--nv-creative)]/15 border border-[var(--nv-creative)]/30 flex items-center justify-center">
              <Icon name={STEP_LUCIDE[stepFlash.step]} size={24} className="text-[var(--nv-creative)]" />
            </span>
            <span className="text-2xl font-bold tracking-wide text-[var(--nv-text-primary)]">
              切换至「{STEP_LABELS[stepFlash.step]}」
            </span>
            <span className="text-[11px] text-[var(--nv-text-tertiary)]">点击顶部进度条可随时回跳继续讨论</span>
          </div>
        </div>
      )}
      {/* ── 顶栏 ── */}
      <header className="sticky top-0 z-10 border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/80 px-5 py-3 backdrop-blur-sm shrink-0" inert={leftDrawerOpen || rightDrawerOpen}>
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nv-text-tertiary)] transition-colors hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
              aria-label="返回"
            >
              <Icon name="arrowLeft" size={18} />
            </Link>
            <div className="flex items-center gap-2.5">
              <Icon name="target" size={20} className="text-[var(--nv-primary)]" />
              <h1 className="text-base font-bold text-[var(--nv-text-primary)]">探讨模式</h1>
            </div>
            <span className="hidden text-[10px] text-[var(--nv-text-tertiary)] sm:inline">
              跟 AI 聊着就把小说世界建好了
            </span>
          </div>
          {/* 全局模式切换 */}
          <div className="mr-2 flex items-center gap-0.5 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-0.5">
            {(["chat", "outline"] as const).map((m) => {
              const active = mode === m;
              const labels: Record<string, React.ReactNode> = { chat: <span className="flex items-center gap-1"><Icon name="message" size={12} /> 自由讨论</span>, outline: <span className="flex items-center gap-1"><Icon name="clipboard" size={12} /> 大纲</span> };
              const titles: Record<string, string> = { chat: "自由讨论：聊天式构建，每次回复附 3 张候选卡", outline: "大纲模式：粘贴整篇大纲，一键抽取角色与设定" };
              return (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  title={titles[m]}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all duration-200 active:scale-95 ${
                  active
                    ? m === "chat"
                      ? "bg-[var(--nv-creative)]/20 text-[var(--nv-creative)] shadow-[0_0_12px_var(--nv-creative-soft)]"
                      : "bg-[var(--nv-primary-soft)] text-[var(--nv-primary)] shadow-sm"
                    : m === "chat"
                      ? "text-[var(--nv-creative)]/70 hover:text-[var(--nv-creative)] hover:bg-[var(--nv-creative)]/10"
                      : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)] hover:bg-[var(--nv-surface-3)]"
                }`}
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTutorial(true)}
              className="rounded-xl border border-[var(--nv-accent)]/30 bg-[var(--nv-accent)]/10 px-3 py-1.5 text-xs font-medium text-[var(--nv-accent)] transition-all duration-200 hover:bg-[var(--nv-accent)]/20 active:scale-95"
              title="探讨模式怎么玩：三个区域、候选卡、一键构筑、生成项目"
            >
              <span className="flex items-center gap-1"><Icon name="lightbulb" size={12} /> 教程</span>
            </button>
            <button
              onClick={() => {
                setBuildPrompt("");
                setBuildModalOpen(true);
              }}
              disabled={generatingAll || aiConfigured === false}
              className="btn-creative px-3.5 py-1.5 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
              title={aiConfigured === false ? "AI 未配置，先去设置页填 Key" : "让 AI 按你的方向一键补齐全部设定（角色/世界观/势力/力量体系/货币/地图/情节）"}
            >
              {generatingAll ? <span className="flex items-center gap-1"><Icon name="loader" size={12} className="animate-spin" /> 生成中...</span> : <span className="flex items-center gap-1"><Icon name="bot" size={13} /> 一键构筑所有设定</span>}
            </button>
            {/* 窄屏：抽屉切换 */}
            <button
              onClick={() => setLeftDrawerOpen(o => !o)}
              className="lg:hidden rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-3 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-all duration-200 hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
              title="切换构建配置（窄屏）"
              aria-label="切换构建配置（窄屏）"
            >
              <Icon name="sliders" size={13} />
            </button>
            <button
              onClick={() => setRightDrawerOpen(o => !o)}
              className="lg:hidden rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-3 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-all duration-200 hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
              title="切换已采纳（窄屏）"
              aria-label="切换已采纳（窄屏）"
            >
              <Icon name="check" size={13} />
            </button>
            {/* 桌面：内联配置开关 */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`hidden lg:inline-flex rounded-xl border px-3.5 py-1.5 text-xs font-medium transition-all duration-200 active:scale-95 ${
                showConfig
                  ? "border-[var(--nv-primary)]/20 bg-[var(--nv-primary-soft)] text-[var(--nv-primary)]"
                  : "border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] text-[var(--nv-text-tertiary)] hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)]"
              }`}
            >
              {showConfig ? "隐藏配置" : "构建配置"}
            </button>
            <button
              onClick={() => {
                setConfig(DEFAULT_BUILD_CONFIG);
                setAdopted([]);
                setMessages([messages[0]]);
                setCreatedProjectId(null);
                setCurrentStep("opening");
                setOutlineResult(null);
                setOutlineProgress(null);
                lastSavedRef.current = "";
                localStorage.removeItem("explore_state");
              }}
              className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] px-3 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-all duration-200 hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
            >
              重开
            </button>
          </div>
        </div>
      </header>

      {/* ── 探讨模式玩法教程 ── */}
      <Modal open={showTutorial} onClose={() => setShowTutorial(false)} title="探讨模式 · 怎么玩" icon="lightbulb">
        <div className="space-y-3 text-xs leading-relaxed text-[var(--nv-text-secondary)]">
          <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
            <p className="font-medium text-[var(--nv-text-primary)]">界面三个区域</p>
            <p className="text-[11px]">左侧「构建配置」：可选，提前告诉 AI 你的偏好（题材/文风/字数），不填也能聊；中间「聊天区」：和 AI 对话的主战场；右侧「已导入设定」：聊出并采纳的内容汇聚处，可逐条编辑。</p>
          </div>
          <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
            <p className="font-medium text-[var(--nv-text-primary)]">怎么聊最省力</p>
            <p className="text-[11px]">每条 AI 回复底部附 <strong>3 张候选卡</strong>——点一张就采纳并自动推进到下一步；不满意点「换一批」重摇。也可以直接打字说你的想法，说到位了让它出卡。顶部「自由讨论 / 大纲」切换：已有完整大纲的话，用大纲模式粘贴进去一键抽取全部设定。</p>
          </div>
          <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
            <p className="font-medium text-[var(--nv-text-primary)]">懒人快捷路径</p>
            <p className="text-[11px]">聊出大方向后，点顶栏「一键构筑所有设定」——AI 按你的方向把角色/世界观/势力/力量体系/货币/地图/情节一次补齐，核对无误后逐条确认即可。</p>
          </div>
          <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
            <p className="font-medium text-[var(--nv-text-primary)]">聊完之后</p>
            <p className="text-[11px]">点「生成项目」落库成小说项目，然后二选一：<strong>小说模式</strong>进写作台继续写；<strong>游戏模式</strong>化身角色亲历这段剧情（跑团扮演，可掷骰检定）。随时可以回探讨模式继续补充设定。</p>
          </div>
        </div>
        <button onClick={() => setShowTutorial(false)} className="mt-4 w-full btn-primary rounded-xl py-2.5 text-sm font-medium">
          开始探讨
        </button>
      </Modal>

      {/* ── 产出目标提示条：游戏本模式（?as=saga）与小说模式共用同一套 11 步，只换口径 ── */}
      {asGame && (
        <div className="shrink-0 border-b border-[var(--nv-creative)]/25 bg-[var(--nv-creative)]/[0.08] px-5 py-2">
          <div className="mx-auto flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <Icon name="gamepad" size={13} className="shrink-0 text-[var(--nv-creative)]" />
            <span className="font-medium text-[var(--nv-text-primary)]">产出：游戏本 · 第一视角自由叙事</span>
            <span className="text-[var(--nv-text-tertiary)]">
              和写小说同一套前置创作——聊出世界观、你扮演的角色、势力与力量体系、开局场景，这些会成为游戏的舞台与首章章纲
            </span>
            <Link href="/explore" className="ml-auto shrink-0 text-[var(--nv-primary)] hover:underline">
              改成写小说 →
            </Link>
          </div>
        </div>
      )}

      {/* ── 11 步探讨进度条 ── */}
      <div inert={leftDrawerOpen || rightDrawerOpen}>
        <StepProgress currentStep={currentStep} adopted={adopted} onStepChange={handleStepChange} />
      </div>

      {/* ── 构思步骤引导：让新手清楚每一步该聊什么 ── */}
      {mode !== "outline" && (
        <StepGuide step={currentStep} asGame={asGame} aiConfigured={aiConfigured} onSend={handleGuideSend} />
      )}

      {/* ── 三栏布局 ── */}
      <div className="flex-1 flex min-h-0">
        {/* 左栏：构建配置 */}
        {(showConfig || leftDrawerOpen) && (
          <aside
            ref={leftDrawerRef}
            tabIndex={-1}
            role={leftDrawerOpen ? "dialog" : undefined}
            aria-modal={leftDrawerOpen ? "true" : undefined}
            aria-labelledby={leftDrawerOpen ? leftDrawerTitleId : undefined}
            className={`w-80 shrink-0 overflow-y-auto border-r border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/60 backdrop-blur-sm fixed inset-y-0 left-0 z-40 max-w-[85vw] h-full transition-transform duration-200 ${leftDrawerOpen ? "translate-x-0" : "-translate-x-full"} lg:static lg:z-auto lg:h-full lg:shrink-0 lg:w-80 lg:translate-x-0 lg:transition-none`}
          >
            <h2 id={leftDrawerTitleId} className="sr-only">构建配置</h2>
            <BuildConfigPanel config={config} onChange={setConfig} />
          </aside>
        )}

        {/* 中栏 */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0" inert={leftDrawerOpen || rightDrawerOpen}>
          {mode === "outline" ? (
            <OutlinePanel
              outlineText={outlineText}
              enrichPrompt={enrichPrompt}
              outlineResult={outlineResult}
              outlineProgress={outlineProgress}
              outlineLoading={outlineLoading}
              creating={creating}
              onTextChange={setOutlineText}
              onEnrichPromptChange={setEnrichPrompt}
              onSubmit={handleOutlineSubmit}
              onConfirm={handleOutlineConfirm}
            />
          ) : (
            <>
              <ChatPanel
                messages={messages}
                loading={loading}
                mode={mode}
                currentStep={currentStep}
                adoptStatus={adoptStatus}
                aiConfigured={aiConfigured}
                onSend={handleSend}
                onStepChange={handleStepChange}
                onModeChange={handleModeChange}
                onAdoptCard={handleAdoptCard}
                onReroll={handleReroll}
              />
            </>
          )}
        </main>

        {/* 右栏：已采纳 */}
        <aside
          ref={rightDrawerRef}
          tabIndex={-1}
          role={rightDrawerOpen ? "dialog" : undefined}
          aria-modal={rightDrawerOpen ? "true" : undefined}
          aria-labelledby={rightDrawerOpen ? rightDrawerTitleId : undefined}
          className={`w-72 shrink-0 overflow-y-auto border-l border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/60 backdrop-blur-sm fixed inset-y-0 right-0 z-40 max-w-[85vw] h-full transition-transform duration-200 ${rightDrawerOpen ? "translate-x-0" : "translate-x-full"} lg:static lg:z-auto lg:h-full lg:shrink-0 lg:w-72 lg:translate-x-0 lg:transition-none`}
        >
          <h2 id={rightDrawerTitleId} className="sr-only">已采纳</h2>
          <AdoptedContentPanel
            adopted={adopted}
            pendingItems={generatePreview}
            onRemove={(id) =>
              setAdopted((prev) => prev.filter((a) => a.id !== id))
            }
            onRemovePending={(id) =>
              setGeneratePreview((prev) => prev.filter((a) => a.id !== id))
            }
            onEditItem={(id, patch) =>
              setAdopted((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
            }
            onEditPending={(id, patch) =>
              setGeneratePreview((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)))
            }
            onDeepDive={handleDeepDive}
            creating={creating}
            createdProjectId={createdProjectId}
            onCreateProject={handleCreateProject}
            asGame={asGame}
          />
        </aside>
        {/* 窄屏抽屉遮罩 */}
        {(leftDrawerOpen || rightDrawerOpen) && (
          <div aria-hidden="true" className="fixed inset-0 z-30 bg-[var(--nv-veil)] lg:hidden" onClick={() => { setLeftDrawerOpen(false); setRightDrawerOpen(false); }} />
        )}
      </div>

      {/* ── AI 一键构筑：方向提示词弹窗 ── */}
      {buildModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="一键构筑所有设定">
          <div className="absolute inset-0 bg-[var(--nv-veil)] backdrop-blur-[2px]" onClick={() => setBuildModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--nv-creative)]/15 border border-[var(--nv-creative)]/30">
                <Icon name="bot" size={15} className="text-[var(--nv-creative)]" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[var(--nv-text-primary)]">一键构筑所有设定</h3>
                <p className="text-[10px] text-[var(--nv-text-muted)] mt-0.5">
                  AI 会补齐你没填的配置 + 生成完整角色/世界观/势力/力量/货币/地图/情节
                </p>
              </div>
            </div>
            <textarea
              autoFocus
              value={buildPrompt}
              onChange={(e) => setBuildPrompt(e.target.value)}
              placeholder={'想朝什么方向构筑？例如：\n「主角是被封印千年的剑灵转世，主线是找回记忆并阻止天渊重开」\n\n留空则按你已填的配置自由发挥'}
              rows={5}
              className="w-full bg-[var(--nv-surface-2)] border border-[var(--nv-border-2)] rounded-xl px-3.5 py-2.5 text-xs text-[var(--nv-text-secondary)] placeholder:text-[var(--nv-text-muted)] focus:outline-none focus:border-[var(--nv-creative)]/40 focus:ring-2 focus:ring-[var(--nv-creative)]/10 resize-none transition-all duration-200"
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setBuildModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-medium btn-ghost"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setBuildModalOpen(false);
                  handleGenerateAll(buildPrompt);
                }}
                disabled={generatingAll || aiConfigured === false}
                className="flex-[2] py-2.5 rounded-xl text-xs font-semibold btn-creative disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                {generatingAll ? <span className="flex items-center gap-1"><Icon name="loader" size={12} className="animate-spin" /> 构筑中...</span> : <span className="flex items-center gap-1"><Icon name="sparkles" size={12} /> 开始构筑</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 子组件：构思步骤引导（默认收起为单行，点击展开说明与示例） ──
function StepGuide({ step, aiConfigured, onSend, asGame }: { step: ExploreStep; aiConfigured: boolean | null; onSend: (text: string) => void; asGame?: boolean }) {
  const prompts = STEP_PROMPTS[step];
  const desc = stepDescription(step, !!asGame);
  const blocked = aiConfigured === false;
  const [open, setOpen] = useState(false);
  return (
    <section className="border-b border-[var(--nv-border-2)] bg-[var(--nv-surface-1)]/60 shrink-0">
      {/* 收起态：单行紧凑条，与下方状态条同风格 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-5 py-1.5 flex items-center gap-2 text-left hover:bg-[var(--nv-surface-2)]/60 transition-colors duration-150"
        title={open ? "收起引导" : "展开本步说明与示例提问"}
      >
        <Icon name={STEP_LUCIDE[step]} size={14} className="text-[var(--nv-creative)] shrink-0" />
        <span className="text-[10px] font-semibold text-[var(--nv-primary)] tracking-wider uppercase shrink-0">我们在聊</span>
        <span className="text-xs font-bold text-[var(--nv-text-primary)] shrink-0">{STEP_LABELS[step]}</span>
        <span className="text-[11px] text-[var(--nv-text-tertiary)] truncate flex-1 min-w-0">{desc}</span>
        <Icon
          name="chevronDown"
          size={14}
          className={`text-[var(--nv-text-muted)] shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {/* 展开态：完整说明 + 可一键发送的示例提问 */}
      {open && (
        <div className="px-5 pb-3 flex flex-col gap-2.5 animate-[nf-card-in_0.3s_ease-out_both]">
          <p className="text-xs text-[var(--nv-text-tertiary)] leading-relaxed pl-6">{desc}</p>
          {blocked ? (
            <div className="flex flex-wrap items-center gap-1.5 pl-6">
              <span className="text-[11px] px-2.5 py-1 rounded-full border border-warning/30 bg-warning/[0.08] text-warning">
                AI 未配置：先去设置页填 Key，才能与 AI 探讨并采纳设定
              </span>
              <Link
                href="/settings"
                className="text-[11px] px-2.5 py-1 rounded-full border border-warning/30 bg-warning/15 text-warning hover:bg-warning/25 transition-colors duration-150"
              >
                去设置页 →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 pl-6">
              {prompts.map((p, i) => (
                <button
                  key={i}
                  onClick={() => onSend(p)}
                  disabled={aiConfigured === null}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)] hover:border-[var(--nv-primary)]/40 hover:text-[var(--nv-primary)] transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
