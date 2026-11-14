/**
 * GET  /api/settings — 获取全局 LLM 设置（Key 仅展示后 4 位）
 * PUT  /api/settings — 更新全局 LLM 设置
 */
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { clearLLMCache } from "@/lib/llm";
import { jsonError } from "@/lib/api-error";
import { maskKey } from "@/lib/llm-config-mask";


export async function GET() {
  try {
    let settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    if (!settings) {
      settings = await prisma.appSettings.create({ data: { id: "default" } });
    }
    return NextResponse.json({
      llmProvider: settings.llmProvider,
      llmApiKey: maskKey(settings.llmApiKey),
      llmModel: settings.llmModel,
      llmBaseUrl: settings.llmBaseUrl,
      disableThinking: settings.disableThinking,
      writerModel: settings.writerModel,
      reviewerModel: settings.reviewerModel,
      summarizeModel: settings.summarizeModel,
      streaming: settings.streaming,
      // 生图（角色卡头像 AI 生成）：Key 与文本 Key 分开，留空=跟随 llmApiKey
      imageBaseUrl: settings.imageBaseUrl,
      imageApiKey: maskKey(settings.imageApiKey),
      imageModel: settings.imageModel,
      hasKey: !!settings.llmApiKey,
      hasImageKey: !!settings.imageApiKey || !!settings.llmApiKey,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { llmProvider, llmApiKey, llmModel, llmBaseUrl, disableThinking, writerModel, reviewerModel, summarizeModel, streaming,
      imageBaseUrl, imageApiKey, imageModel } = body;

    const data: Record<string, string | boolean> = {};
    if (typeof llmProvider === "string") data.llmProvider = llmProvider;
    if (typeof llmApiKey === "string") data.llmApiKey = llmApiKey;
    if (typeof llmModel === "string") data.llmModel = llmModel;
    if (typeof llmBaseUrl === "string") data.llmBaseUrl = llmBaseUrl;
    if (typeof disableThinking === "boolean") data.disableThinking = disableThinking;
    if (typeof streaming === "boolean") data.streaming = streaming;
    // 分工模型：允许空串（= 清空跟随默认模型）
    if (typeof writerModel === "string") data.writerModel = writerModel.trim();
    if (typeof reviewerModel === "string") data.reviewerModel = reviewerModel.trim();
    if (typeof summarizeModel === "string") data.summarizeModel = summarizeModel.trim();
    // 生图配置：Base/模型允许空串（= 用默认值）；Key 空串=跟随 llmApiKey，不覆盖已存值
    if (typeof imageBaseUrl === "string") data.imageBaseUrl = imageBaseUrl.trim();
    if (typeof imageApiKey === "string" && imageApiKey.trim()) data.imageApiKey = imageApiKey.trim();
    if (typeof imageModel === "string") data.imageModel = imageModel.trim();
    // 预设 provider（非 custom/local）的 Base URL 由代码固定（PROVIDER_BASE_URLS），
    // 忽略前端可能误传的残留 baseUrl，避免污染后续生成请求（根因：残留 URL 致生成打到错误地址）。
    if (typeof data.llmProvider === "string" && ["siliconflow", "deepseek", "openai", "groq"].includes(data.llmProvider)) {
      data.llmBaseUrl = ""; // 显式清空，确保库与生成请求都干净（预设 provider 的 URL 由代码固定）
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 });
    }

    await prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });

    // 立即失效缓存，下次 LLM 调用使用新配置
    clearLLMCache();

    return NextResponse.json({ ok: true });
  } catch (err) {
    return jsonError(err);
  }
}
